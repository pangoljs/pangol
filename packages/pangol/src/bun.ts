// Bun adapter: `import { serve } from 'pangol/bun'`. Kept out of the main entry so the core stays
// runtime-neutral; it only touches the global `Bun`, so pangol needs no Bun type package.
import type { App } from './runtime/app.js'

interface BunServer {
  readonly port: number
  readonly url: URL
  requestIP(request: Request): { readonly address: string } | null
  stop(closeActiveConnections?: boolean): unknown
}
interface BunRuntime {
  serve(options: {
    port?: number
    hostname?: string
    maxRequestBodySize?: number
    fetch(request: Request, server: BunServer): Response | Promise<Response>
    error(error: unknown): Response
  }): BunServer
}

export interface ServeOptions {
  /** 0 picks a free port. Default 3000. */
  readonly port?: number
  readonly hostname?: string
}

const INTERNAL = '{"error":"internal error"}'
const HEADERS = { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'cache-control': 'no-store' }

export function serve(app: App, options: ServeOptions = {}): BunServer {
  const bun = (globalThis as { Bun?: BunRuntime }).Bun
  if (bun === undefined) throw new Error("pangol/bun needs the Bun runtime; on other runtimes use app.fetch with that runtime's server")
  return bun.serve({
    port: options.port ?? 3000,
    ...(options.hostname !== undefined && { hostname: options.hostname }),
    // The app enforces its own limit and answers 413 with the usual JSON and headers. Bun's limit is a
    // backstop 1 MiB above it: past that, Bun answers a bare 413 before the app sees the request.
    maxRequestBodySize: app.limits.body + 1024 * 1024,
    fetch: (request, server) => app.fetch(request, { ip: server.requestIP(request)?.address ?? '' }),
    error: () => new Response(INTERNAL, { status: 500, headers: HEADERS }),
  })
}
