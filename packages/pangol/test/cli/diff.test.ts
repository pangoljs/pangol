import { describe, expect, it } from 'vitest'
import { diff, failed, formatDiff, isMoneyField, isOwnerField, isPrivilegeField, looksSecret, type Change } from '../../src/cli/diff.js'
import type { Manifest, RouteManifest } from '../../src/cli/manifest.js'

const ownerFn = (source: string, usesUser: boolean | 'unknown' = true) => ({ kind: 'function' as const, source, hash: source, usesUser })
const r = (over: Partial<RouteManifest> = {}): RouteManifest => ({
  file: 'src/routes/x.ts', auth: 'user', owner: { kind: 'missing' }, load: null, params: {}, query: {}, body: {},
  response: { id: 'id' }, responseIsList: false, usesUser: true, rateLimit: null, handler: 'h1', imports: {}, ...over,
})
const m = (routes: Record<string, RouteManifest>, files: Record<string, string> = { 'src/auth.ts': 'a1' }): Manifest =>
  ({ pangol: 1, auth: { file: 'src/auth.ts', from: 'bearer', files }, routes })
const record = (over: Partial<RouteManifest> = {}) => r({ params: { id: 'id' }, load: { source: 'load', hash: 'l1' }, owner: ownerFn('(c, p) => p.ownerId === c.user.id'), ...over })

const levels = (changes: Change[]) => changes.map((c) => `${c.level} ${c.route ?? '-'}: ${c.what}`)
const only = (base: Record<string, RouteManifest>, head: Record<string, RouteManifest>) => levels(diff(m(base), m(head)))

describe('field names', () => {
  it('spots secrets, owner, privilege and money fields by their words', () => {
    for (const f of ['passwordHash', 'hash', 'resetCodeHash', 'password', 'api_key', 'apiKey', 'accessToken', 'user.resetToken', 'items[].secret', 'salt', 'privateKey']) expect(looksSecret(f), f).toBe(true)
    for (const f of ['hashtag', 'tokenizer', 'name', 'passage', 'id']) expect(looksSecret(f), f).toBe(false)
    for (const f of ['userId', 'owner_id', 'authorId', 'createdBy', 'tenantId']) expect(isOwnerField(f), f).toBe(true)
    for (const f of ['postId', 'user_name', 'id']) expect(isOwnerField(f), f).toBe(false)
    for (const f of ['role', 'isAdmin', 'permissions', 'emailVerified']) expect(isPrivilegeField(f), f).toBe(true)
    for (const f of ['title', 'roleDescription']) expect(isPrivilegeField(f), f).toBe(false)
    for (const f of ['price', 'totalAmount', 'shipping_fee', 'items[].unitPrice']) expect(isMoneyField(f), f).toBe(true)
    for (const f of ['priceless', 'count', 'title']) expect(isMoneyField(f), f).toBe(false)
  })
})

describe('🔴 needs review', () => {
  it('auth gets weaker', () => {
    expect(only({ 'DELETE /posts/:id': record({ auth: { permission: 'admin' } }) }, { 'DELETE /posts/:id': record({ auth: 'user' }) }))
      .toContain("high DELETE /posts/:id: auth is weaker: { permission: 'admin' } → 'user'")
    expect(only({ 'GET /posts/:id': record() }, { 'GET /posts/:id': record({ auth: 'public', owner: { kind: 'none' } }) })[0]).toMatch(/^high .*auth is weaker/)
    // a GET without params becoming public is 🟡: usually a listing or a health check
    expect(only({ 'GET /posts': r({ usesUser: false }) }, { 'GET /posts': r({ auth: 'public', usesUser: false }) })).toHaveLength(1)
    expect(only({ 'GET /posts': r({ usesUser: false }) }, { 'GET /posts': r({ auth: 'public', usesUser: false }) })[0]).toMatch(/^medium .*'user' → 'public'/)
  })

  it('owner becomes none or disappears', () => {
    expect(only({ 'PATCH /posts/:id': record() }, { 'PATCH /posts/:id': record({ owner: { kind: 'none' } }) }))
      .toContain("high PATCH /posts/:id: owner became 'none' (was a function)")
    expect(only({ 'PATCH /posts/:id': record({ owner: { kind: 'query' } }) }, { 'PATCH /posts/:id': record({ owner: { kind: 'none' } }) })[0]).toMatch(/^high/)
  })

  it("an owner rule that does not read c.user, and a new owner: 'none' for signed-in users", () => {
    expect(only({}, { 'GET /posts/:id': record({ owner: ownerFn('(c, p) => p.published', false) }) })[0]).toMatch(/^high .*never reads c\.user/)
    expect(only({}, { 'DELETE /posts/:id': record({ owner: { kind: 'none' } }) })[0]).toMatch(/^high .*owner: 'none'/)
    // with a permission it is a deliberate admin route: 🟡
    expect(only({}, { 'DELETE /posts/:id': record({ auth: { permission: 'admin' }, owner: { kind: 'none' } }) })[0]).toMatch(/^medium .*owner: 'none'/)
  })

  it('a response sends a secret-looking field', () => {
    expect(only({ 'GET /me': r() }, { 'GET /me': r({ response: { id: 'id', passwordHash: 'string' } }) })).toContain('high GET /me: response sends `passwordHash`, which looks like a secret')
  })

  it('input accepts owner, privilege or money fields', () => {
    const head = { 'POST /posts': r({ body: { title: 'string', authorId: 'id', role: 'enum', price: 'money', categoryId: 'id' } }) }
    const out = only({ 'POST /posts': r({ body: { title: 'string' } }) }, head)
    expect(out.filter((l) => l.startsWith('high'))).toHaveLength(3)
    expect(out).toContain('medium POST /posts: body accepts `categoryId`, the id of another record: `owner` does not check it')
    // fields that were already there are not reported again
    expect(only(head, head)).toEqual([])
  })

  it('money declared as a number', () => {
    expect(only({}, { 'POST /orders': r({ body: { total: 'number' } }) })).toContain('high POST /orders: body field `total` looks like money but is t.number(): use t.money()')
    expect(only({}, { 'POST /orders': r({ body: { total: 'money' } }) }).filter((l) => l.includes('money'))).toEqual(['high POST /orders: body accepts `total`, a money field: the caller may set a price or amount'])
  })

  it('the handler stops reading c.user, or auth changes', () => {
    expect(only({ 'GET /feed': r() }, { 'GET /feed': r({ usesUser: false, handler: 'h2' }) })).toContain('high GET /feed: the handler no longer reads c.user')
    expect(levels(diff(m({}), m({}, { 'src/auth.ts': 'a2' })))).toEqual(['high -: auth changed: src/auth.ts; every route depends on it'])
    expect(levels(diff(m({}), m({}, { 'src/auth.ts': 'a1', 'src/session.ts': 's1' })))).toEqual(['high -: auth changed: src/session.ts; every route depends on it'])
  })
})

describe('🟡 look at', () => {
  it('owner, its helpers and load change, with the source before and after', () => {
    const changes = diff(m({ 'PATCH /posts/:id': record({ imports: { 'src/lib/acl.ts': 'x1' } }) }), m({ 'PATCH /posts/:id': record({ owner: ownerFn('(c, p) => isOwner(c.user, p)'), load: { source: 'load2', hash: 'l2' }, imports: { 'src/lib/acl.ts': 'x2' } }) }))
    expect(levels(changes)).toEqual([
      'medium PATCH /posts/:id: the owner rule changed',
      'medium PATCH /posts/:id: files this route imports changed (the owner rule may call them): src/lib/acl.ts',
      'medium PATCH /posts/:id: `load` changed',
    ])
    expect(changes[0]).toMatchObject({ before: '(c, p) => p.ownerId === c.user.id', after: '(c, p) => isOwner(c.user, p)' })
  })

  it("owner: 'query', new response fields, list handlers and a removed rate limit", () => {
    expect(only({ 'GET /a/:id': record() }, { 'GET /a/:id': record({ owner: { kind: 'query' } }) })[0]).toMatch(/^medium .*'query'/)
    expect(only({ 'GET /me': r() }, { 'GET /me': r({ response: { id: 'id', email: 'email' } }) })).toEqual(['medium GET /me: response sends a new field `email`'])
    expect(only({ 'GET /posts': r({ responseIsList: true }) }, { 'GET /posts': r({ responseIsList: true, handler: 'h2' }) })[0]).toMatch(/^medium .*list/)
    expect(only({ 'POST /login': r({ rateLimit: '5/min' }) }, { 'POST /login': r() })).toEqual(['medium POST /login: rate limit removed (was 5/min)'])
  })
})

describe('✓ and ℹ', () => {
  it('a new route that follows the rules is ✓, with what it exposes', () => {
    const out = diff(m({}), m({ 'GET /posts/:id': record({ response: { id: 'id', title: 'string' } }) }))
    expect(levels(out)).toEqual(["ok GET /posts/:id: new route: auth 'user', owner function, sends `id`, `title`"])
    expect(out[0]?.after).toContain('c.user.id')
  })

  it('handler changes, stronger auth, removed fields and removed routes are info', () => {
    expect(only({ 'GET /a': r({ auth: 'optional' }), 'GET /b': r() }, { 'GET /a': r({ auth: 'user', response: {}, handler: 'h2' }) })).toEqual([
      "info GET /a: auth is stronger: 'optional' → 'user'",
      'info GET /a: response no longer sends `id`',
      'info GET /a: the handler changed (business logic is not checked)',
      'info GET /b: route removed',
    ])
  })

  it('identical manifests have no changes', () => {
    const same = { 'GET /posts/:id': record() }
    expect(diff(m(same), m(same))).toEqual([])
  })
})

describe('output and exit', () => {
  const changes = diff(m({ 'PATCH /posts/:id': record() }), m({ 'PATCH /posts/:id': record({ owner: { kind: 'none' } }), 'GET /health': r({ auth: 'public', usesUser: false }) }))

  it('markdown for a PR comment, sorted by risk', () => {
    const md = formatDiff(changes, 'markdown')
    expect(md.startsWith('## pangol security diff\n\n🔴 1 need review · 🟡 1 to look at')).toBe(true)
    expect(md.indexOf('### 🔴 Needs review')).toBeLessThan(md.indexOf('### 🟡 Look at'))
    expect(md).toContain("- **PATCH /posts/:id**: owner became 'none' (was a function)")
    expect(md).toContain('```js\n  (c, p) => p.ownerId === c.user.id')
    expect(formatDiff([], 'text')).toBe('No security-relevant changes.')
  })

  it('--fail-on', () => {
    expect(failed(changes, 'high')).toBe(true)
    expect(failed(changes.filter((c) => c.level !== 'high'), 'high')).toBe(false)
    expect(failed(changes.filter((c) => c.level !== 'high'), 'medium')).toBe(true)
    expect(failed(changes, undefined)).toBe(false)
  })
})
