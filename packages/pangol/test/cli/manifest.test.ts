import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { expect, it } from 'vitest'
import { check } from '../../src/cli/check.js'
import { buildManifest, fieldPaths } from '../../src/cli/manifest.js'
import { route, t } from '../../src/index.js'

const root = fileURLToPath(new URL('./fixtures/good', import.meta.url))

it('lists field paths with their kind; ? marks optional or defaulted', () => {
  expect(fieldPaths(t.object({ id: t.id(), items: t.array(t.object({ price: t.money(), tags: t.array(t.string()) })), note: t.string().optional(), page: t.int().default(1) }))).toEqual({
    id: 'id', items: 'array', 'items[].price': 'money', 'items[].tags': 'array', 'items[].tags[]': 'string', note: 'string?', page: 'int?',
  })
  expect(fieldPaths(t.array(t.object({ id: t.id() })))).toEqual({ '[].id': 'id' })
  expect(fieldPaths(t.empty())).toEqual({})
})

it('describes what each loaded route exposes', async () => {
  const result = await check({ root, ts })
  const m = buildManifest(ts, root, result)
  expect(m.pangol).toBe(1)
  expect(m.auth.file).toBe('src/auth.ts')
  expect(m.auth.from).toBe('bearer')
  expect(Object.keys(m.auth.files)).toEqual(['src/auth.ts'])
  expect(Object.keys(m.routes)).toEqual(['GET /health', 'GET /posts', 'PATCH /posts/:id', 'POST /posts/:id/publish'])

  const patch = m.routes['PATCH /posts/:id']!
  expect(patch).toMatchObject({
    file: 'src/routes/posts/[id].patch.ts',
    auth: 'user',
    params: { id: 'id' },
    body: { title: 'string?' },
    response: { id: 'id', authorId: 'id', title: 'string', price: 'money' },
    responseIsList: false,
    usesUser: false,
    rateLimit: null,
  })
  expect(patch.owner).toMatchObject({ kind: 'function', usesUser: true })
  expect(patch.owner.kind === 'function' && patch.owner.source).toContain('c.user.id')
  expect(patch.load?.source).toContain('loadPost')
  // the owner's helper and the models it reaches are recorded, so a change to them shows in the diff
  expect(Object.keys(patch.imports)).toEqual(['src/models.ts', 'src/routes/posts/_owned.ts'])
  expect(m.routes['GET /posts']).toMatchObject({ responseIsList: true, usesUser: true, response: { '[].id': 'id', '[].price': 'money' }, owner: { kind: 'missing' } })
  expect(m.routes['POST /posts/:id/publish']).toMatchObject({ auth: { permission: 'admin' }, owner: { kind: 'none' }, response: {} })
  expect(JSON.parse(JSON.stringify(m))).toEqual(m) // plain JSON
})

it("records whether the owner rule reads c.user (the diff flags one that does not)", () => {
  const owner = (usesUser: (c: { user: { id: string } }, p: { authorId: string; published: boolean }) => boolean) => route({
    auth: 'user', params: t.object({ id: t.id() }), load: () => ({ authorId: 'a', published: true }), owner: usesUser, response: t.string(), handler: (c) => String(c.resource.published),
  })
  const at = (definition: object) => buildManifest(ts, root, { findings: [], routes: [{ key: 'GET /x/:id', file: 'src/routes/health.get.ts', definition: definition as never }] }).routes['GET /x/:id']!.owner
  expect(at(owner((_c, p) => p.published))).toMatchObject({ kind: 'function', usesUser: false })
  expect(at(owner((c, p) => p.authorId === c.user.id))).toMatchObject({ kind: 'function', usesUser: true })
  expect(at(owner((c, p) => check2(c, p)))).toMatchObject({ kind: 'function', usesUser: 'unknown' })
})
const check2 = (c: unknown, p: unknown) => c !== p
