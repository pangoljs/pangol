// CORS (SPEC section 8): off by default, on only for origins listed exactly. Never a wildcard.
import { describe, expect, it } from 'vitest'
import { createApp, defineAuth, route, t } from '../../src/index.js'

const ada = { id: 'ada', permissions: [] }
const APP = 'https://app.example.com'
const routes = {
  'GET /posts': route({ auth: 'public', response: t.array(t.string()), handler: () => ['a'] }),
  'POST /posts': route({ auth: 'user', body: t.object({ title: t.string() }), response: t.empty(), handler: (c) => c.noContent() }),
  'DELETE /posts/:id': route({ auth: 'user', owner: 'none', response: t.empty(), handler: (c) => c.noContent() }),
  'GET /me': route({ auth: 'user', response: t.string(), handler: (c) => c.user.id }),
}
const bearer = createApp({ auth: defineAuth({ from: 'bearer', resolve: () => ada }), cors: { origins: [APP, 'http://localhost:5173'] }, routes })
const cookie = createApp({ auth: defineAuth({ from: { cookie: 'sid' }, resolve: () => ada }), cors: { origins: [APP] }, routes })
const closed = createApp({ auth: defineAuth({ from: 'bearer', resolve: () => ada }), routes })

const send = (app: typeof bearer, method: string, path: string, headers: Record<string, string> = {}) =>
  app.fetch(new Request('http://api.test' + path, { method, headers }))
const preflight = (app: typeof bearer, path: string, origin: string, method = 'POST', requestHeaders?: string) =>
  send(app, 'OPTIONS', path, { origin, 'access-control-request-method': method, ...(requestHeaders !== undefined && { 'access-control-request-headers': requestHeaders }) })
const cors = (res: Response) => Object.fromEntries([...res.headers].filter(([k]) => k.startsWith('access-control-') || k === 'vary'))

describe('actual requests', () => {
  it('an allowed origin gets its own origin back, never *', async () => {
    const res = await send(bearer, 'GET', '/posts', { origin: APP })
    expect(res.status).toBe(200)
    expect(cors(res)).toEqual({ 'access-control-allow-origin': APP, vary: 'origin' })
    expect(cors(await send(bearer, 'GET', '/posts', { origin: 'http://localhost:5173' }))['access-control-allow-origin']).toBe('http://localhost:5173')
  })

  it('error responses carry the headers too, so the browser app can read { error }', async () => {
    for (const [method, path] of [['GET', '/me'], ['GET', '/nope'], ['PUT', '/posts']]) {
      const res = await send(bearer, method as string, path as string, { origin: APP })
      expect(res.status, path).toBeGreaterThanOrEqual(400)
      expect(cors(res)['access-control-allow-origin'], path).toBe(APP)
    }
  })

  it('any other origin gets no CORS headers, only Vary', async () => {
    for (const origin of ['https://evil.test', 'https://app.example.com.evil.test', 'https://APP.example.com', 'http://app.example.com', 'null', `${APP}, https://evil.test`]) {
      const res = await send(bearer, 'GET', '/posts', { origin })
      expect(res.status, origin).toBe(200) // the server answers; the browser keeps the answer from the page
      expect(cors(res), origin).toEqual({ vary: 'origin' })
    }
    expect(cors(await send(bearer, 'GET', '/posts'))).toEqual({ vary: 'origin' })
  })

  it('credentials are allowed only with cookie auth', async () => {
    expect(cors(await send(cookie, 'GET', '/posts', { origin: APP }))['access-control-allow-credentials']).toBe('true')
    expect(cors(await send(bearer, 'GET', '/posts', { origin: APP }))['access-control-allow-credentials']).toBeUndefined()
  })

  it('without cors, nothing is added', async () => {
    expect(cors(await send(closed, 'GET', '/posts', { origin: APP }))).toEqual({})
  })
})

describe('preflight (OPTIONS)', () => {
  it('answers 204 with the methods of that path and the headers the app reads', async () => {
    const res = await preflight(bearer, '/posts', APP, 'POST', 'content-type, authorization')
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
    expect(cors(res)).toEqual({
      'access-control-allow-origin': APP,
      'access-control-allow-methods': 'GET, POST',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      vary: 'origin',
    })
    expect(cors(await preflight(bearer, '/posts/p1', APP, 'DELETE'))['access-control-allow-methods']).toBe('DELETE')
    expect(cors(await preflight(cookie, '/posts', APP))['access-control-allow-credentials']).toBe('true')
  })

  it('refuses an origin that is not listed, without CORS headers', async () => {
    const res = await preflight(bearer, '/posts', 'https://evil.test')
    expect(res.status).toBe(403)
    expect(cors(res)).toEqual({ vary: 'origin' })
  })

  it('an unknown path is still a 404', async () => {
    expect((await preflight(bearer, '/nope', APP)).status).toBe(404)
  })

  it('OPTIONS that is not a preflight, or on an app without cors, is a 405 as before', async () => {
    expect((await send(bearer, 'OPTIONS', '/posts')).status).toBe(405)
    expect((await send(bearer, 'OPTIONS', '/posts', { origin: APP })).status).toBe(405)
    const res = await preflight(closed, '/posts', APP)
    expect(res.status).toBe(405)
    expect(cors(res)).toEqual({})
  })

  it('extra request headers and max-age can be declared', async () => {
    const app = createApp({ cors: { origins: [APP], headers: ['X-Request-Id'], maxAge: 60 }, routes: { 'GET /x': route({ auth: 'public', response: t.string(), handler: () => 'x' }) } })
    const res = await preflight(app, '/x', APP, 'GET')
    expect(cors(res)['access-control-allow-headers']).toBe('authorization, content-type, x-request-id')
    expect(cors(res)['access-control-max-age']).toBe('60')
  })
})

describe('the origin list is checked when the app starts', () => {
  const start = (cors: unknown) => () => createApp({ cors: cors as never, routes: { 'GET /x': route({ auth: 'public', response: t.string(), handler: () => 'x' }) } })

  it('refuses wildcards and anything that is not one exact origin', () => {
    for (const origin of ['*', 'null', 'https://app.example.com/', 'https://app.example.com/path', 'app.example.com', 'https://APP.example.com', 'https://app.example.com:443', 'ftp://app.example.com', 'https://*.example.com', '']) {
      expect(start({ origins: [origin] }), origin).toThrow(/cors\.origins/)
    }
    expect(start({ origins: [] })).toThrow(/cors\.origins/)
    expect(start({ origins: 'https://app.example.com' })).toThrow(/cors\.origins/)
  })

  it('refuses bad header names and max-age', () => {
    expect(start({ origins: [APP], headers: ['bad header'] })).toThrow(/cors\.headers/)
    expect(start({ origins: [APP], maxAge: -1 })).toThrow(/cors\.maxAge/)
    expect(start({ origins: [APP], maxAge: 86_401 })).toThrow(/cors\.maxAge/)
    expect(start({ origins: [APP], credentials: true })).toThrow(/cors.*credentials/) // decided by the auth, not an option
  })
})
