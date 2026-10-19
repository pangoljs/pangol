/// <reference types="node" />
// SPEC section 15: every adapter answers the same. Each case goes through app.fetch (the fetch
// adapter) and over real HTTP through this runtime's server adapter (node:http on Node, Bun.serve
// on Bun); status, body and the headers clients rely on must match exactly.
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp, defineAuth, route, t } from '../src/index.js'
import { raw, type RawResponse } from './helpers/http.js'

const onBun = 'Bun' in globalThis
const posts = new Map([['p1', { id: 'p1', authorId: 'ada', title: 'Hello', notes: 'secret' }]])
const users: Record<string, { id: string; permissions: string[] }> = {
  ada: { id: 'ada', permissions: ['publish'] }, bob: { id: 'bob', permissions: [] },
}
const app = createApp({
  auth: defineAuth({ from: { cookie: 'sid' }, resolve: (r) => users[r.credential] ?? null }),
  cors: { origins: ['https://app.example.com'] },
  limits: { body: 64 },
  log: () => {},
  routes: {
    'GET /health': route({ auth: 'public', response: t.object({ ok: t.bool() }), handler: () => ({ ok: true }) }),
    'GET /posts/search': route({ auth: 'public', query: t.object({ q: t.string({ max: 5 }), page: t.int({ min: 1 }).default(1) }),
      response: t.object({ q: t.string(), page: t.int() }), handler: (c) => c.query }),
    'GET /posts/:id': route({ auth: 'user', params: t.object({ id: t.id() }), response: t.object({ id: t.id(), title: t.string() }),
      load: (c) => posts.get(c.params.id) ?? null, owner: (c, p) => p.authorId === c.user.id, handler: (c) => c.resource }),
    'PATCH /posts/:id': route({ auth: { permission: 'publish' }, params: t.object({ id: t.id() }), body: t.object({ title: t.string({ min: 1 }) }),
      response: t.object({ id: t.id(), title: t.string() }), load: async (c) => posts.get(c.params.id) ?? null,
      owner: (c, p) => p.authorId === c.user.id, handler: async (c) => ({ id: c.resource.id, title: c.body.title }) }),
    'POST /posts': route({ auth: 'user', body: t.object({ title: t.string() }), response: t.object({ id: t.id() }), handler: (c) => c.created({ id: 'p2' }) }),
    'DELETE /session': route({ auth: 'user', response: t.empty(), handler: (c) => c.noContent() }),
    'GET /conflict': route({ auth: 'public', response: t.string(), handler: (c) => c.fail(409, 'taken') }),
    'GET /boom': route({ auth: 'public', response: t.string(), handler: () => { throw new Error('x') } }),
    'GET /limited': route({ auth: 'public', rateLimit: '1/min', response: t.string(), handler: () => 'ok' }),
  },
})

type Case = [name: string, method: string, path: string, headers?: Record<string, string>, body?: string]
const json = { 'content-type': 'application/json' }
const ada = { cookie: 'sid=ada' }
const cases: Case[] = [
  ['public route', 'GET', '/health'],
  ['unknown route', 'GET', '/nope'],
  ['wrong method', 'PUT', '/posts/p1', ada],
  ['trailing slash', 'GET', '/health/'],
  ['empty segment', 'GET', '/posts//p1', ada],
  ['encoded slash', 'GET', '/posts/a%2Fb', ada],
  ['encoded unreserved', 'GET', '/%68ealth'],
  ['lowercase hex', 'GET', '/posts/%e0%b8%81', ada],
  ['literal beats param', 'GET', '/posts/search?q=ab'],
  ['query default and +', 'GET', '/posts/search?q=a+b'],
  ['query repeated', 'GET', '/posts/search?q=a&q=b'],
  ['query not canonical', 'GET', '/posts/search?q=a&page=01'],
  ['query bad UTF-8', 'GET', '/posts/search?q=%E0%B8'],
  ['no credential', 'GET', '/posts/p1'],
  ['unknown session', 'GET', '/posts/p1', { cookie: 'sid=eve' }],
  ['cookie sent twice', 'GET', '/posts/p1', { cookie: 'sid=ada; sid=bob' }],
  ['owner', 'GET', '/posts/p1', ada],
  ['not owner -> 404', 'GET', '/posts/p1', { cookie: 'sid=bob' }],
  ['missing record', 'GET', '/posts/p9', ada],
  ['permission missing', 'PATCH', '/posts/p1', { ...json, cookie: 'sid=bob', 'sec-fetch-site': 'same-origin' }, '{"title":"x"}'],
  ['cross-site write', 'PATCH', '/posts/p1', { ...json, ...ada, 'sec-fetch-site': 'cross-site', origin: 'https://evil.test' }, '{"title":"x"}'],
  ['trusted origin write', 'PATCH', '/posts/p1', { ...json, ...ada, 'sec-fetch-site': 'cross-site', origin: 'https://app.example.com' }, '{"title":"New"}'],
  ['invalid body', 'PATCH', '/posts/p1', { ...json, ...ada }, '{"title":""}'],
  ['not JSON', 'POST', '/posts', { 'content-type': 'text/plain', ...ada }, 'title=x'],
  ['broken JSON', 'POST', '/posts', { ...json, ...ada }, '{"title":'],
  ['duplicate key', 'POST', '/posts', { ...json, ...ada }, '{"title":"a","title":"b"}'],
  ['prototype key', 'POST', '/posts', { ...json, ...ada }, '{"__proto__":{"x":1},"title":"a"}'],
  ['body too large', 'POST', '/posts', { ...json, ...ada }, JSON.stringify({ title: 'x'.repeat(100) })],
  ['created', 'POST', '/posts', { ...json, ...ada }, '{"title":"T"}'],
  ['no content', 'DELETE', '/session', ada],
  ['fail', 'GET', '/conflict'],
  ['handler throws', 'GET', '/boom'],
  ['CORS: listed origin', 'GET', '/health', { origin: 'https://app.example.com' }],
  ['CORS: other origin', 'GET', '/health', { origin: 'https://evil.test' }],
  ['CORS: origin sent twice', 'GET', '/health', { origin: 'https://app.example.com, https://evil.test' }],
  ['CORS: error to listed origin', 'GET', '/posts/p1', { origin: 'https://app.example.com' }],
  ['CORS: preflight', 'OPTIONS', '/posts/p1', { origin: 'https://app.example.com', 'access-control-request-method': 'PATCH' }],
  ['CORS: preflight from other origin', 'OPTIONS', '/posts/p1', { origin: 'https://evil.test', 'access-control-request-method': 'PATCH' }],
  ['OPTIONS without preflight', 'OPTIONS', '/posts/p1'],
]

const SEEN = ['content-type', 'x-content-type-options', 'x-frame-options', 'cache-control', 'allow', 'vary',
  'access-control-allow-origin', 'access-control-allow-credentials', 'access-control-allow-methods', 'access-control-allow-headers', 'access-control-max-age']
interface Seen { status: number; body: string; headers: Record<string, string | null> }
const viaFetch = async ([, method, path, headers = {}, body]: Case): Promise<Seen> => {
  const res = await app.fetch(new Request('http://127.0.0.1' + path, { method, headers, ...(body !== undefined && { body }) }), { ip: '127.0.0.1' })
  return { status: res.status, body: await res.text(), headers: Object.fromEntries(SEEN.map((name) => [name, res.headers.get(name)])) }
}
const one = (v: string | string[] | undefined) => (v === undefined ? null : Array.isArray(v) ? v.join(', ') : v)
const fromRaw = (res: RawResponse): Seen => ({
  status: res.status, body: res.body, headers: Object.fromEntries(SEEN.map((name) => [name, one(res.headers[name])])),
})

describe(`conformance: fetch adapter vs ${onBun ? 'Bun.serve' : 'node:http'} adapter`, () => {
  let port = 0
  let stop: () => Promise<void> = async () => {}
  beforeAll(async () => {
    if (onBun) {
      const { serve } = await import('../src/bun.js')
      const server = serve(app, { port: 0, hostname: '127.0.0.1' })
      port = server.port
      stop = async () => { await server.stop(true) }
    } else {
      const { createServer } = await import('../src/node.js')
      const server = createServer(app)
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
      port = (server.address() as AddressInfo).port
      stop = () => new Promise((resolve) => server.close(() => resolve()))
    }
  })
  afterAll(() => stop())

  for (const c of cases) {
    it(c[0], async () => {
      const [, method, path, headers = {}, body] = c
      expect(fromRaw(await raw(port, method, path, headers, body))).toEqual(await viaFetch(c))
    })
  }

  // Documented differences (SPEC section 3): Bun and the fetch API normalize these paths before the
  // app sees them, so those adapters serve the normalized path; node:http passes the raw
  // request-target and the strict check rejects it. No adapter may serve any other path.
  const normalized: [raw: string, fetchSees: string, bunSees: string][] = [
    ['/x/../health', '/health', '/health'],
    ['/x/%2E%2E/health', '/health', '/health'],
    ['/./health', '/health', '/health'],
    ['//health', '//health', '/health'],
  ]
  for (const [path, fetchSees, bunSees] of normalized) {
    it(`documented difference: ${path}`, async () => {
      const seen = fromRaw(await raw(port, 'GET', path))
      if (onBun) expect(seen).toEqual(await viaFetch(['', 'GET', bunSees]))
      else expect(seen.status).toBe(400)
      expect(new URL('http://127.0.0.1' + path).pathname).toBe(fetchSees)
    })
  }

  it('shares one rate limiter: both adapters run the same app', async () => {
    expect((await viaFetch(['', 'GET', '/limited'])).status).toBe(200)
    expect((await raw(port, 'GET', '/limited')).status).toBe(429) // same client 127.0.0.1, same limiter
  })
})
