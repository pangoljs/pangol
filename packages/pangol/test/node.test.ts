/// <reference types="node" />
// The Node adapter on node:http. Runs on Node only; Bun has pangol/bun.
import type { AddressInfo } from 'node:net'
import { Agent, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, defineAuth, route, t } from '../src/index.js'
import { createServer } from '../src/node.js'
import { raw } from './helpers/http.js'

const onBun = 'Bun' in globalThis

describe.runIf(!onBun)('node:http adapter', () => {
  let server: Server
  let port = 0
  const app = createApp({
    auth: defineAuth({ from: 'bearer', resolve: (r) => (r.credential === 'good' ? { id: 'ada', permissions: [] } : null) }),
    limits: { body: 64 },
    log: () => {},
    routes: {
      'GET /health': route({ auth: 'public', response: t.string(), handler: () => 'ok' }),
      'GET /me': route({ auth: 'user', response: t.string(), handler: (c) => c.user.id }),
      'GET /agent': route({ auth: 'public', response: t.string(), handler: (c) => c.headers.get('user-agent') ?? '' }),
      'POST /echo': route({ auth: 'public', body: t.object({ s: t.string() }), response: t.string(), handler: (c) => c.body.s }),
      'GET /boom': route({ auth: 'public', response: t.string(), handler: () => { throw new Error('boom') } }),
    },
  })

  beforeAll(async () => {
    server = createServer(app)
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    port = (server.address() as AddressInfo).port
  })
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

  it('serves a route', async () => {
    expect(await raw(port, 'GET', '/health')).toMatchObject({ status: 200, body: '"ok"' })
  })

  it('reads the raw request-target, so dot-segments the fetch API would normalize are rejected', async () => {
    for (const path of ['/health/%2E%2E', '/a/../health', '/./health', '/health/.']) {
      expect((await raw(port, 'GET', path)).status, path).toBe(400)
    }
    expect((await raw(port, 'GET', 'http://api.test/health')).status).toBe(200) // absolute-form
  })

  it('treats a repeated Authorization header as malformed (401), not first-wins', async () => {
    expect((await raw(port, 'GET', '/me', { authorization: 'Bearer good' })).body).toBe('"ada"')
    expect((await raw(port, 'GET', '/me', { authorization: ['Bearer good', 'Bearer other'] })).status).toBe(401)
  })

  it('answers 413 for an oversized body, closes that connection and keeps serving', async () => {
    const res = await raw(port, 'POST', '/echo', { 'content-type': 'application/json' }, JSON.stringify({ s: 'x'.repeat(200) }))
    expect(res.status).toBe(413)
    expect(res.headers['connection']).toBe('close')
    expect((await raw(port, 'POST', '/echo', { 'content-type': 'application/json' }, '{"s":"hi"}')).body).toBe('"hi"')
  })

  it('keeps connections alive: a bodiless request is complete even before Node says so', async () => {
    // regression: `req.complete` is still false while the 'request' event runs, so every response
    // said `connection: close` and each request paid for a new TCP connection
    let connections = 0
    const count = () => { connections++ }
    server.on('connection', count)
    const agent = new Agent({ keepAlive: true, maxSockets: 1 })
    try {
      for (const [method, path, body] of [['GET', '/health'], ['GET', '/me'], ['POST', '/echo', '{"s":"hi"}'], ['GET', '/health']] as const) {
        const res = await raw(port, method, path, { 'content-type': 'application/json' }, body, agent)
        expect(res.headers['connection'], `${method} ${path}`).not.toBe('close')
        expect(res.headers['content-length'], `${method} ${path}`).toBe(String(Buffer.byteLength(res.body)))
      }
      expect(connections).toBe(1)
    } finally {
      agent.destroy()
      server.off('connection', count)
    }
  })

  it('closes the connection when a body was sent but never read', async () => {
    // GET /health reads no body; one that arrives anyway must not be drained by the server
    const res = await raw(port, 'GET', '/health', { 'content-type': 'application/json', 'content-length': '5' }, 'hello')
    expect(res.status).toBe(200)
    expect(res.headers['connection']).toBe('close')
  })

  it('a handler that throws is a 500 and the server keeps running', async () => {
    expect((await raw(port, 'GET', '/boom')).status).toBe(500)
    expect((await raw(port, 'GET', '/health')).status).toBe(200)
  })

  it('gives handlers c.headers', async () => {
    expect((await raw(port, 'GET', '/agent', { 'user-agent': 'probe/1' })).body).toBe('"probe/1"')
  })

  it('never builds a fetch Request (SPEC section 3: the Node fast path)', async () => {
    const original = globalThis.Request
    let built = 0
    globalThis.Request = new Proxy(original, { construct(target, args) { built++; return Reflect.construct(target, args) } })
    try {
      await raw(port, 'GET', '/me', { authorization: 'Bearer good' })
      await raw(port, 'POST', '/echo', { 'content-type': 'application/json' }, '{"s":"hi"}')
    } finally {
      globalThis.Request = original
    }
    expect(built).toBe(0)
  })

  it('sets the timeouts from SPEC section 8', () => {
    expect(server.requestTimeout).toBe(10_000)
    expect(server.headersTimeout).toBe(5_000)
  })
})
