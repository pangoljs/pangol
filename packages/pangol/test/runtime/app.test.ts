// The request pipeline end to end, through app.fetch (the fetch adapter). SPEC section 3 order:
// path 400 -> route 404/405 -> auth 401/403 -> rate limit 429 -> validate 400/413/415
// -> load 404 -> owner 404 -> handler -> serialize 500.
import { describe, expect, it } from 'vitest'
import { createApp, defineAuth, route, t } from '../../src/index.js'

const users: Record<string, { id: string; permissions: string[]; name: string }> = {
  'tok-ada': { id: 'ada', permissions: ['posts:publish'], name: 'Ada' },
  'tok-bob': { id: 'bob', permissions: [], name: 'Bob' },
}
const posts = new Map([['p1', { id: 'p1', authorId: 'ada', title: 'Hello', secret: 'draft notes' }]])
const auth = defineAuth({ from: 'bearer', resolve: (req) => users[req.credential] ?? null })
const Post = t.object({ id: t.id(), title: t.string() })

const app = createApp({
  auth,
  routes: {
    'GET /health': route({ auth: 'public', response: t.object({ ok: t.bool() }), handler: () => ({ ok: true }) }),
    'GET /posts/search': route({ auth: 'public', response: t.string(), handler: () => 'search' }),
    'GET /posts/:id': route({
      auth: 'user', params: t.object({ id: t.id() }), response: Post,
      load: (c) => posts.get(c.params.id) ?? null,
      owner: (c, post) => post.authorId === c.user.id,
      handler: (c) => c.resource,
    }),
    'PATCH /posts/:id': route({
      auth: { permission: 'posts:publish' }, params: t.object({ id: t.id() }),
      body: t.object({ title: t.string({ min: 1, max: 20 }) }), response: Post,
      load: async (c) => posts.get(c.params.id) ?? null,
      owner: (c, post) => post.authorId === c.user.id,
      handler: async (c) => ({ ...c.resource, title: c.body.title }),
    }),
    'POST /posts': route({
      auth: 'user', body: t.object({ title: t.string() }), response: Post,
      handler: (c) => c.created({ id: 'p2', title: c.body.title }),
    }),
    'GET /me': route({ auth: 'optional', response: t.string(), handler: (c) => c.user?.name ?? 'guest' }),
    'GET /list': route({
      auth: 'public', query: t.object({ limit: t.int({ min: 1, max: 50 }).default(10), tag: t.string().optional() }),
      response: t.object({ limit: t.int(), tag: t.string().optional() }), handler: (c) => c.query,
    }),
    'DELETE /session': route({ auth: 'user', response: t.empty(), handler: (c) => c.noContent() }),
    'GET /conflict': route({ auth: 'public', response: t.string(), handler: (c) => c.fail(409, 'already exists') }),
  },
})

async function call(method: string, path: string, init: { token?: string; body?: string; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...init.headers }
  if (init.token) headers['authorization'] = `Bearer ${init.token}`
  if (init.body !== undefined) headers['content-type'] ??= 'application/json'
  const res = await app.fetch(new Request('http://api.test' + path, { method, headers, ...(init.body !== undefined && { body: init.body }) }))
  const text = await res.text()
  return { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) as unknown : undefined }
}

describe('routing', () => {
  it('serves a public route', async () => {
    expect(await call('GET', '/health')).toMatchObject({ status: 200, json: { ok: true } })
  })
  it('rejects a non-canonical path before routing', async () => {
    for (const p of ['/health/', '//health', '/posts/a%2Fb', '/posts/a%5Cb', '/%68ealth', '/posts/%00']) expect((await call('GET', p)).status, p).toBe(400)
  })
  it('limitation: a fetch Request has a URL the runtime already normalized', async () => {
    // new Request() parses the URL (WHATWG) and removes dot-segments, encoded ones included, before
    // the app sees it: "/posts/%2E%2E" arrives as "/". The Node adapter reads the raw request-target
    // and rejects it with 400 (SPEC section 8); through fetch the app can only route what it is given.
    expect(new Request('http://api.test/posts/%2E%2E').url).toBe('http://api.test/')
    expect((await call('GET', '/posts/%2E%2E')).status).toBe(404)
  })
  it('answers 404 for an unknown path and 405 with Allow for a known path', async () => {
    expect((await call('GET', '/nope')).status).toBe(404)
    const res = await call('PUT', '/posts/p1')
    expect(res.status).toBe(405)
    expect(res.headers.get('allow')).toBe('GET, PATCH')
  })
  it('prefers a literal segment over a param', async () => {
    expect((await call('GET', '/posts/search')).json).toBe('search')
  })
})

describe('auth', () => {
  it('401 without a credential, with a malformed one, or an unknown token', async () => {
    expect((await call('GET', '/posts/p1')).status).toBe(401)
    expect((await call('GET', '/posts/p1', { headers: { authorization: 'Basic abc' } })).status).toBe(401)
    expect((await call('GET', '/posts/p1', { token: 'nope' })).status).toBe(401)
  })
  it('403 without the permission', async () => {
    expect((await call('PATCH', '/posts/p1', { token: 'tok-bob', body: '{"title":"x"}' })).status).toBe(403)
  })
  it("'optional': anonymous without a credential, 401 with a bad one", async () => {
    expect((await call('GET', '/me')).json).toBe('guest')
    expect((await call('GET', '/me', { token: 'tok-ada' })).json).toBe('Ada')
    expect((await call('GET', '/me', { token: 'nope' })).status).toBe(401)
  })
  it("'public' ignores the Authorization header", async () => {
    expect((await call('GET', '/health', { token: 'nope' })).status).toBe(200)
  })
})

describe('validation', () => {
  it('validates the body and names the field', async () => {
    const res = await call('PATCH', '/posts/p1', { token: 'tok-ada', body: '{"title":""}' })
    expect(res).toMatchObject({ status: 400, json: { field: 'body.title' } })
  })
  it('415 for a non-JSON content type, 400 for broken JSON', async () => {
    expect((await call('POST', '/posts', { token: 'tok-ada', body: 'title=x', headers: { 'content-type': 'text/plain' } })).status).toBe(415)
    expect((await call('POST', '/posts', { token: 'tok-ada', body: '{"title":' })).status).toBe(400)
    expect((await call('POST', '/posts', { token: 'tok-ada', body: '{"title":"a","title":"b"}' })).status).toBe(400)
  })
  it('413 when the body is over the limit', async () => {
    const big = JSON.stringify({ title: 'x'.repeat(1_100_000) })
    expect((await call('POST', '/posts', { token: 'tok-ada', body: big })).status).toBe(413)
  })
  it('parses the query strictly', async () => {
    expect((await call('GET', '/list?limit=5&tag=a+b')).json).toEqual({ limit: 5, tag: 'a b' })
    expect((await call('GET', '/list')).json).toEqual({ limit: 10 })
    expect((await call('GET', '/list?limit=5&limit=6')).json).toMatchObject({ field: 'query.limit' })
    expect((await call('GET', '/list?limit=051')).status).toBe(400)
    expect((await call('GET', '/list?tag=%E0%B8')).status).toBe(400) // truncated UTF-8
  })
})

describe('load and owner', () => {
  it('returns the loaded record filtered by the response schema', async () => {
    const res = await call('GET', '/posts/p1', { token: 'tok-ada' })
    expect(res.json).toEqual({ id: 'p1', title: 'Hello' })
    expect(res.text).not.toContain('draft notes')
  })
  it('404, not 403, when the caller is not the owner: existence is not revealed', async () => {
    const notOwner = await call('GET', '/posts/p1', { token: 'tok-bob' })
    const missing = await call('GET', '/posts/p9', { token: 'tok-bob' })
    expect(notOwner.status).toBe(404)
    expect(notOwner.text).toBe(missing.text)
  })
  it('runs async load and handler', async () => {
    expect((await call('PATCH', '/posts/p1', { token: 'tok-ada', body: '{"title":"New"}' })).json).toEqual({ id: 'p1', title: 'New' })
  })
})

describe('results and headers', () => {
  it('201 for created, 204 for noContent, the given 4xx for fail', async () => {
    expect(await call('POST', '/posts', { token: 'tok-ada', body: '{"title":"T"}' })).toMatchObject({ status: 201, json: { id: 'p2', title: 'T' } })
    expect(await call('DELETE', '/session', { token: 'tok-ada' })).toMatchObject({ status: 204, text: '' })
    expect(await call('GET', '/conflict')).toMatchObject({ status: 409, json: { error: 'already exists' } })
  })
  it('sends the security headers on every response, including errors and 204', async () => {
    for (const res of [await call('GET', '/health'), await call('GET', '/nope'), await call('DELETE', '/session', { token: 'tok-ada' })]) {
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(res.headers.get('x-frame-options')).toBe('DENY')
      expect(res.headers.get('cache-control')).toBe('no-store')
    }
  })
})
