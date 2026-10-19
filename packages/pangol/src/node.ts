/// <reference types="node" />
// Node adapter: `import { createServer, serve } from 'pangol/node'`. Straight on node:http: no fetch
// Request is built (SPEC section 3), and the raw request-target is checked, so every path form of
// SPEC section 8 is rejected, including dot-segments a fetch runtime would have normalized away.
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { Reject } from './core/strict.js'
import { JSON_HEADERS, Out, SECURITY_HEADERS, handlerOf, type App, type Incoming } from './runtime/app.js'

export interface ServeOptions {
  /** 0 picks a free port. Default 3000. */
  readonly port?: number
  readonly hostname?: string
}

const INTERNAL = new Out(500, '{"error":"internal error"}')

export function createServer(app: App): Server {
  const handle = handlerOf(app)
  const server = createHttpServer((req, res) => {
    // node:http keeps only the first of some repeated headers (Authorization, Content-Type…);
    // join them like the fetch API does, so a repeated header is malformed rather than first-wins.
    const header = (name: string): string | null => req.headersDistinct[name]?.join(name === 'cookie' ? '; ' : ', ') ?? null
    let headers: Headers | undefined
    const incoming = (target: string, query: string): Incoming => ({
      method: req.method ?? '', target, query, host: req.headers.host ?? '', ip: req.socket.remoteAddress ?? '',
      get headers() { return headers ??= toHeaders(req) },
      header,
      readBody: (limit) => readBody(req, limit),
    })
    let out: Out | Promise<Out>
    try { out = handle(req.method ?? '', req.url ?? '', incoming) } catch { out = INTERNAL }
    if (out instanceof Out) send(req, res, out) // synchronous routes answer without a Promise
    else out.then((o) => send(req, res, o), () => send(req, res, INTERNAL))
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  return server
}

export function serve(app: App, options: ServeOptions = {}): Server {
  const server = createServer(app)
  server.listen(options.port ?? 3000, options.hostname)
  return server
}

function send(req: IncomingMessage, res: ServerResponse, out: Out): void {
  if (res.headersSent || res.destroyed) return
  let headers: Record<string, string> = out.body === null ? SECURITY_HEADERS : JSON_HEADERS
  // A body left unread (too large, or a route without one) would be read and discarded to keep the
  // connection alive; close it instead, so a client cannot make the server swallow a huge upload.
  const close = !req.complete
  if (out.allow !== undefined || close) headers = { ...headers, ...(out.allow !== undefined && { allow: out.allow }), ...(close && { connection: 'close' }) }
  res.writeHead(out.status, headers)
  res.end(out.body ?? undefined)
}

function toHeaders(req: IncomingMessage): Headers {
  const headers = new Headers()
  const raw = req.rawHeaders
  for (let i = 0; i + 1 < raw.length; i += 2) {
    try { headers.append(raw[i] as string, raw[i + 1] as string) } catch { /* a value fetch refuses: leave it out */ }
  }
  return headers
}

function readBody(req: IncomingMessage, limit: number): Promise<Uint8Array> {
  const length = req.headers['content-length']
  if (length !== undefined) {
    if (!/^[0-9]{1,15}$/.test(length)) return Promise.reject(new Reject(400, 'bad_content_length'))
    if (Number(length) > limit) return Promise.reject(new Reject(413, 'body_too_large'))
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    const done = (settle: () => void) => {
      req.off('data', onData); req.off('end', onEnd); req.off('error', onError); req.off('close', onClose)
      settle()
    }
    const onData = (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) { req.pause(); done(() => reject(new Reject(413, 'body_too_large'))); return } // stop at once
      chunks.push(chunk)
    }
    const onEnd = () => done(() => resolve(chunks.length === 1 ? chunks[0] as Buffer : Buffer.concat(chunks, size)))
    const onError = (e: unknown) => done(() => reject(e))
    const onClose = () => done(() => reject(new Reject(400, 'incomplete_body')))
    req.on('data', onData).on('end', onEnd).on('error', onError).on('close', onClose)
  })
}
