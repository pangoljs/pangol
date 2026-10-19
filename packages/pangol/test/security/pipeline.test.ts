// Security regressions for the request pipeline, including the PoC bugs found in the audit
// (C3 async auth bypass, C4 crash on a sync throw, C5 unbounded rate limiter).
import { describe, expect, it } from 'vitest'
import { createApp, defineAuth, route, t } from '../../src/index.js'
import { createLimiter } from '../../src/runtime/ratelimit.js'

const ada = { id: 'ada', permissions: ['admin'] }
const send = (app: { fetch(r: Request, i?: { ip?: string }): Promise<Response> }, method: string, path: string, headers: Record<string, string> = {}, ip = '') =>
  app.fetch(new Request('http://api.test' + path, { method, headers }), { ip })

describe('C3: async resolve is awaited', () => {
  const app = createApp({
    auth: defineAuth({ from: 'bearer', resolve: async (req) => (req.credential === 'good' ? ada : null) }),
    routes: { 'GET /me': route({ auth: 'user', response: t.string(), handler: (c) => c.user.id }) },
  })
  it('a Promise resolving to null is a 401, not a signed-in user', async () => {
    expect((await send(app, 'GET', '/me', { authorization: 'Bearer forged' })).status).toBe(401)
  })
  it('a Promise resolving to a user signs in', async () => {
    expect(await (await send(app, 'GET', '/me', { authorization: 'Bearer good' })).json()).toBe('ada')
  })
})

describe('C4: handler errors become a 500 without taking the server down', () => {
  const logs: string[] = []
  const app = createApp({
    log: (m) => logs.push(m),
    routes: {
      'GET /boom': route({ auth: 'public', response: t.string(), handler: () => { throw new Error('db password is hunter2') } }),
      'GET /wrong': route({ auth: 'public', response: t.object({ id: t.id() }), handler: () => ({ id: 42 }) as never }),
      'GET /status': route({ auth: 'public', response: t.string(), handler: (c) => c.fail(200 as never, 'ok') }),
      'GET /ok': route({ auth: 'public', response: t.string(), handler: () => 'ok' }),
    },
  })
  it('a synchronous throw answers 500 with a generic body and logs the details', async () => {
    const res = await send(app, 'GET', '/boom')
    expect(res.status).toBe(500)
    const body = await res.text()
    expect(body).toBe('{"error":"internal error"}')
    expect(logs.join('\n')).toContain('hunter2')
    expect((await send(app, 'GET', '/ok')).status).toBe(200) // still serving
  })
  it('a response that does not match the schema is a 500, not a coerced value', async () => {
    expect((await send(app, 'GET', '/wrong')).status).toBe(500)
    expect(logs.join('\n')).toContain('response.id')
  })
  it('c.fail with a non-4xx status (from JavaScript) is a 500', async () => {
    expect((await send(app, 'GET', '/status')).status).toBe(500)
  })
})

describe('C5: rate limiting', () => {
  const app = createApp({
    routes: { 'GET /login': route({ auth: 'public', rateLimit: '2/min', response: t.string(), handler: () => 'ok' }) },
  })
  it('limits per caller', async () => {
    expect((await send(app, 'GET', '/login', {}, '1.1.1.1')).status).toBe(200)
    expect((await send(app, 'GET', '/login', {}, '1.1.1.1')).status).toBe(200)
    expect((await send(app, 'GET', '/login', {}, '1.1.1.1')).status).toBe(429)
    expect((await send(app, 'GET', '/login', {}, '2.2.2.2')).status).toBe(200)
  })
  it('keeps memory bounded however many callers there are', () => {
    const limiter = createLimiter('5/min', { maxKeys: 100 })
    for (let i = 0; i < 10_000; i++) limiter.hit(`ip-${i}`)
    expect(limiter.size()).toBeLessThanOrEqual(200)
  })
  it('refuses a rate limit it cannot parse when the app starts', () => {
    for (const rateLimit of ['10/fortnight', 'ten/min', '10', '0/min']) {
      expect(() => createApp({ routes: { 'GET /x': route({ auth: 'public', rateLimit, response: t.string(), handler: () => 'x' }) } }), rateLimit).toThrow()
    }
  })
})

describe('cookie auth: cross-origin protection on unsafe methods', () => {
  const app = createApp({
    auth: defineAuth({ from: { cookie: 'sid' }, resolve: (req) => (req.credential === 's1' ? ada : null) }),
    cors: { origins: ['https://app.example.com'] },
    routes: {
      'POST /transfer': route({ auth: 'user', response: t.string(), handler: () => 'sent' }),
      'GET /balance': route({ auth: 'user', response: t.string(), handler: () => '100' }),
    },
  })
  const post = (headers: Record<string, string>) => send(app, 'POST', '/transfer', { cookie: 'sid=s1', host: 'api.test', ...headers })
  it('blocks cross-site requests', async () => {
    expect((await post({ 'sec-fetch-site': 'cross-site', origin: 'https://evil.test' })).status).toBe(403)
    expect((await post({ 'sec-fetch-site': 'same-site', origin: 'https://evil.api.test' })).status).toBe(403)
    expect((await post({ origin: 'https://evil.test' })).status).toBe(403)
    expect((await post({ origin: 'null' })).status).toBe(403)
  })
  it('allows same-origin, listed origins and non-browser clients', async () => {
    expect((await post({ 'sec-fetch-site': 'same-origin' })).status).toBe(200)
    expect((await post({ 'sec-fetch-site': 'none' })).status).toBe(200)
    expect((await post({ 'sec-fetch-site': 'cross-site', origin: 'https://app.example.com' })).status).toBe(200)
    expect((await post({ origin: 'http://api.test' })).status).toBe(200)
    expect((await post({})).status).toBe(200)
  })
  it('does not apply to safe methods', async () => {
    expect((await send(app, 'GET', '/balance', { cookie: 'sid=s1', 'sec-fetch-site': 'cross-site' })).status).toBe(200)
  })
  it('treats a cookie sent twice as ambiguous (401)', async () => {
    expect((await send(app, 'GET', '/balance', { cookie: 'sid=s1; sid=s2' })).status).toBe(401)
  })
})

describe('startup checks: an app that would be unsafe does not start', () => {
  const ok = { auth: 'public', response: t.string(), handler: () => 'x' } as const
  const user = defineAuth({ from: 'bearer', resolve: () => null })
  const cases: [string, () => unknown][] = [
    ['record route without owner', () => createApp({ auth: user, routes: { 'GET /posts/:id': route({ auth: 'user', params: t.object({ id: t.id() }), response: t.string(), handler: () => 'x' }) } })],
    ['params do not match the path', () => createApp({ routes: { 'GET /posts/:id': route({ ...ok, params: t.object({ postId: t.id() }) }) } })],
    ['body on GET', () => createApp({ routes: { 'GET /x': route({ ...ok, body: t.object({ a: t.string() }) }) } })],
    ['non-public route without auth', () => createApp({ routes: { 'GET /x': route({ ...ok, auth: 'user' }) } })],
    ['unknown option', () => createApp({ routes: { 'GET /x': { ...route(ok), hanlder: () => 'x' } } })],
    ['invalid route key', () => createApp({ routes: { ['FETCH /x' as string]: route(ok) } })],
    ['non-canonical path', () => createApp({ routes: { 'GET /x/': route(ok) } })],
    ['same route twice', () => createApp({ routes: { 'GET /a/:x': route({ ...ok, owner: 'none' }), 'GET /a/:y': route({ ...ok, owner: 'none' }) } })],
  ]
  for (const [name, start] of cases) it(name, () => expect(start).toThrow())
  it('the unknown-option error suggests the intended name', () => {
    expect(cases[4]?.[1]).toThrow(/did you mean `handler`/)
  })
})
