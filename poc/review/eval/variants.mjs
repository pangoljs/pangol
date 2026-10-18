// Simulated pull requests against ../app. Each edit is { file, from, to } (exact text replace) or
// { file, create }. `confirm` = hidden tests (round:task:name-prefix) that must FAIL on the variant,
// proving the vulnerability is real. Written BEFORE running the diff (no tuning to results).
const O = 'src/routes/orders/[id].get.js'
const OP = 'src/routes/orders/index.post.js'
const UP = 'src/routes/users/index.post.js'
const UG = 'src/routes/users/[id].get.js'
const PL = 'src/routes/posts/index.get.js'

export const VARIANTS = [
  // ------------------------------------------------------------------ vulnerable
  { id: 'V01', kind: 'vuln', cls: 'IDOR (path)', what: 'order owner rule replaced by none',
    edits: [{ file: O, from: '  owner: (c, order) => order.userId === c.user.id,', to: "  owner: 'none'," }], confirm: ['1:task09:IDOR'] },
  { id: 'V02', kind: 'vuln', cls: 'IDOR (path)', what: 'owner rule only checks the caller is signed in',
    edits: [{ file: O, from: '  owner: (c, order) => order.userId === c.user.id,', to: '  owner: (c, order) => Boolean(c.user && order),' }], confirm: ['1:task09:IDOR'] },
  { id: 'V03', kind: 'vuln', cls: 'IDOR (path)', what: "owner: 'query' claimed, handler does not filter",
    edits: [{ file: O, from: '  owner: (c, order) => order.userId === c.user.id,', to: "  owner: 'query'," }], confirm: ['1:task09:IDOR'] },
  { id: 'V04', kind: 'vuln', cls: 'IDOR (path)', what: 'shared guard helper weakened (_guards.js)',
    edits: [{ file: 'src/routes/_guards.js', from: "post.authorId === c.user.id || c.user.permissions.includes('posts:moderate')", to: "post.authorId === c.user.id || c.user.permissions.length >= 0" }], confirm: ['1:task05:IDOR', '1:task06:IDOR'] },
  { id: 'V05', kind: 'vuln', cls: 'Auth weakened', what: 'user lookup: permission users:read -> any user',
    edits: [{ file: UG, from: "  auth: { permission: 'users:read' },", to: "  auth: 'user'," }], confirm: ['1:task03:without users:read'] },
  { id: 'V06', kind: 'vuln', cls: 'Mass assignment', what: 'create user accepts role',
    edits: [{ file: UP, from: 'email: t.email() }),\n  response', to: "email: t.email(), role: t.enum(['admin', 'member']).optional() }),\n  response" },
            { file: UP, from: "role: 'member'", to: "role: c.body.role ?? 'member'" }], confirm: ['1:task04:mass assignment'] },
  { id: 'V07', kind: 'vuln', cls: 'Mass assignment', what: 'order accepts userId (order on behalf of others)',
    edits: [{ file: OP, from: 'quantity: t.int({ min: 1, max: 10 }) }),', to: 'quantity: t.int({ min: 1, max: 10 }), userId: t.string().optional() }),' },
            { file: OP, from: 'userId: c.user.id,', to: 'userId: c.body.userId ?? c.user.id,' }], confirm: ['2:task08:cannot order on behalf'] },
  { id: 'V08', kind: 'vuln', cls: 'Mass assignment', what: 'order accepts price from the client',
    edits: [{ file: OP, from: 'quantity: t.int({ min: 1, max: 10 }) }),', to: 'quantity: t.int({ min: 1, max: 10 }), price: t.number().optional() }),' },
            { file: OP, from: 'product.price * c.body.quantity', to: '(c.body.price ?? product.price) * c.body.quantity' }], confirm: ['1:task08:client price'] },
  { id: 'V09', kind: 'vuln', cls: 'IDOR (body)', what: 'order accepts addressId with no ownership check',
    edits: [{ file: OP, from: 'quantity: t.int({ min: 1, max: 10 }) }),', to: 'quantity: t.int({ min: 1, max: 10 }), addressId: t.string() }),' }], confirm: [] },
  { id: 'V10', kind: 'vuln', cls: 'Data exposure', what: 'order response adds paymentToken',
    edits: [{ file: O, from: 'total: t.number() }),', to: 'total: t.number(), paymentToken: t.string() }),' }], confirm: ['1:task09:no paymentToken'] },
  { id: 'V11', kind: 'vuln', cls: 'Data exposure', what: '/me adds innocently named "credentials" = passwordHash',
    edits: [{ file: 'src/routes/me.get.js', from: 'email: t.email() }), handler: (c) => c.user', to: 'email: t.email(), credentials: t.string() }), handler: (c) => ({ ...c.user, credentials: c.user.passwordHash })' }], confirm: ['1:task01:/me does not leak'] },
  { id: 'V12', kind: 'vuln', cls: 'IDOR (list)', what: 'post list stops hiding other people\'s drafts',
    edits: [{ file: PL, from: '    .filter((p) => p.published || (c.user && p.authorId === c.user.id))\n', to: '' }], confirm: ['1:task07:other users do not see'] },
  { id: 'V13', kind: 'vuln', cls: 'IDOR (list)', what: 'post list adds ?includeDrafts that shows everyone\'s drafts',
    edits: [{ file: PL, from: 'authorId: t.string().optional() }),', to: 'authorId: t.string().optional(), includeDrafts: t.bool().default(false) }),' },
            { file: PL, from: '.filter((p) => p.published ||', to: '.filter((p) => c.query.includeDrafts || p.published ||' }], confirm: [] },
  { id: 'V14', kind: 'vuln', cls: 'IDOR (body)', what: 'new PATCH /posts with the post id in the body, no ownership check',
    edits: [{ file: 'src/routes/posts/index.patch.js', create: `import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  body: t.object({ id: t.string(), title: t.string({ min: 1, max: 200 }) }),
  response: t.object({ id: t.string(), title: t.string() }),
  handler: (c) => db.posts.update(c.body.id, { title: c.body.title }) ?? c.fail(404, 'not found'),
})
` }], confirm: [] },
  { id: 'V15', kind: 'vuln', cls: 'Auth weakened', what: 'new public GET /users/export listing all users',
    edits: [{ file: 'src/routes/users/export.get.js', create: `import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'public',
  response: t.array(t.object({ id: t.string(), name: t.string(), email: t.email() })),
  handler: () => db.users.all(),
})
` }], confirm: [] },
  { id: 'V16', kind: 'vuln', cls: 'Abuse protection', what: 'rate limit removed from POST /orders',
    edits: [{ file: OP, from: "  rateLimit: '30/min',\n", to: '' }], confirm: [] },
  { id: 'V17', kind: 'vuln', cls: 'Auth weakened', what: 'auth.js accepts any token that looks like t-<number>',
    edits: [{ file: 'src/auth.js', from: '  resolve: (token) => db.sessions.userForToken(token),', to: "  resolve: (token) => db.sessions.userForToken(token) ?? (/^t-\\d+$/.test(token) ? db.users.get(token.slice(2)) : undefined)," }], confirm: [] },
  { id: 'V18', kind: 'vuln', cls: 'IDOR (path)', what: 'order lookup reads the id from a query param, bypassing load/owner',
    edits: [{ file: O, from: "  params: t.object({ id: t.string() }),", to: "  params: t.object({ id: t.string() }),\n  query: t.object({ orderId: t.string().optional() })," },
            { file: O, from: '  handler: (c) => c.resource,', to: '  handler: (c) => (c.query.orderId ? db.orders.get(c.query.orderId) : c.resource),' }], confirm: [] },

  // ------------------------------------------------ external review cases (RT-01..06, written by a reviewer)
  { id: 'R01', kind: 'vuln', cls: 'IDOR (path)', what: 'RT-01 load rewrites the owner field so owner always passes',
    edits: [{ file: O, from: '  load: (c) => db.orders.get(c.params.id),', to: '  load: (c) => ({ ...db.orders.get(c.params.id), userId: c.user.id }),' }], confirm: ['1:task09:IDOR'] },
  { id: 'R02', kind: 'vuln', cls: 'IDOR (path)', what: 'RT-02 load fetches own post, handler deletes c.params.id',
    edits: [{ file: 'src/routes/posts/[id].delete.js', from: '  load: (c) => db.posts.get(c.params.id),', to: '  load: (c) => db.posts.all().find((p) => p.authorId === c.user.id),' },
            { file: 'src/routes/posts/[id].delete.js', from: '    db.posts.delete(c.resource.id)', to: '    db.posts.delete(c.params.id)' }], confirm: ['1:task06:IDOR'] },
  { id: 'R03a', kind: 'vuln', cls: 'Business logic', what: 'RT-03 brute-force lockout removed from login handler',
    edits: [{ file: 'src/routes/auth/login.post.js', from: "    if (recent.length >= 5) return c.fail(429, 'too many attempts')\n", to: '' }], confirm: ['1:task10:lockout: 6th'] },
  { id: 'R03b', kind: 'vuln', cls: 'Business logic', what: "RT-03 handler creates users with role 'admin'",
    edits: [{ file: UP, from: "role: 'member'", to: "role: 'admin'" }], confirm: ['1:task04:creates user'] },
  { id: 'R04', kind: 'vuln', cls: 'IDOR (path)', what: 'RT-04 new DELETE /orders/:id with owner () => true',
    edits: [{ file: 'src/routes/orders/[id].delete.js', create: `import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.orders.get(c.params.id),
  owner: (c, order) => true,
  response: t.empty(),
  handler: (c) => c.noContent(),
})
` }], confirm: [] },
  { id: 'R04b', kind: 'vuln', cls: 'IDOR (path)', what: 'RT-04 variant: owner () => true, handler uses c.resource',
    edits: [{ file: 'src/routes/orders/[id].delete.js', create: `import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.orders.get(c.params.id),
  owner: (c, order) => order.id !== '',
  response: t.empty(),
  handler: (c) => { void c.resource; return c.noContent() },
})
` }], confirm: [] },
  { id: 'R05', kind: 'vuln', cls: 'IDOR (query)', what: 'RT-05 new GET /orders/invoice?userId=…',
    edits: [{ file: 'src/routes/orders/invoice.get.js', create: `import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  query: t.object({ userId: t.string() }),
  response: t.object({ count: t.int() }),
  handler: (c) => {
    let count = 0
    for (let i = 1; i <= 50; i++) if (db.orders.get(String(i))?.userId === c.query.userId) count++
    return { count }
  },
})
` }], confirm: [] },
  { id: 'R06', kind: 'vuln', cls: 'IDOR (list)', what: 'RT-06 list wrapped in {items,total} and draft filter removed',
    edits: [{ file: PL, from: 'response: t.array(t.object({ id: t.string(), title: t.string(), authorId: t.string() })),', to: 'response: t.object({ items: t.array(t.object({ id: t.string(), title: t.string(), authorId: t.string() })), total: t.int() }),' },
            { file: PL, from: `  handler: (c) => db.posts.all()
    .filter((p) => p.published || (c.user && p.authorId === c.user.id))
    .filter((p) => c.query.authorId === undefined || p.authorId === c.query.authorId),`, to: `  handler: (c) => {
    const items = db.posts.all().filter((p) => c.query.authorId === undefined || p.authorId === c.query.authorId)
    return { items, total: items.length }
  },` }], confirm: ['2:task07:other users do not see'] },

  // ------------------------------------------------------------------ benign
  { id: 'B01', kind: 'benign', what: 'error message wording', edits: [{ file: OP, from: "'not enough stock'", to: "'this product is out of stock'" }] },
  { id: 'B02', kind: 'benign', what: 'new public GET /version', edits: [{ file: 'src/routes/version.get.js', create: `import { route, t } from 'hyperflat'
export default route({ auth: 'public', response: t.object({ version: t.string() }), handler: () => ({ version: '1.2.0' }) })
` }] },
  { id: 'B03', kind: 'benign', what: 'new GET /posts/:id with a proper owner rule', edits: [{ file: 'src/routes/posts/[id].get.js', create: `import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'optional',
  params: t.object({ id: t.string() }),
  load: (c) => db.posts.get(c.params.id),
  owner: (c, post) => post.published || (c.user !== null && post.authorId === c.user.id),
  response: t.object({ id: t.string(), title: t.string(), body: t.string(), authorId: t.string() }),
  handler: (c) => c.resource,
})
` }] },
  { id: 'B04', kind: 'benign', what: 'refactor post list (same behaviour)', edits: [{ file: PL, from: `  handler: (c) => db.posts.all()
    .filter((p) => p.published || (c.user && p.authorId === c.user.id))
    .filter((p) => c.query.authorId === undefined || p.authorId === c.query.authorId),`, to: `  handler: (c) => {
    const visible = (p) => p.published || (c.user && p.authorId === c.user.id)
    const byAuthor = (p) => c.query.authorId === undefined || p.authorId === c.query.authorId
    return db.posts.all().filter((p) => visible(p) && byAuthor(p))
  },` }] },
  { id: 'B05', kind: 'benign', what: 'tighten: editing posts requires posts:write', edits: [{ file: 'src/routes/posts/[id].patch.js', from: "  auth: 'user',", to: "  auth: { permission: 'posts:write' }," }] },
  { id: 'B06', kind: 'benign', what: 'post list adds published flag to items', edits: [{ file: PL, from: 'authorId: t.string() })),', to: 'authorId: t.string(), published: t.bool() })),' }] },
  { id: 'B07', kind: 'benign', what: 'rename inside guard helper (same logic)', edits: [{ file: 'src/routes/_guards.js', from: "export const isAuthorOrModerator = (c, post) => post.authorId === c.user.id || c.user.permissions.includes('posts:moderate')", to: "export const isAuthorOrModerator = (ctx, post) => post.authorId === ctx.user.id || ctx.user.permissions.includes('posts:moderate')" }] },
  { id: 'B08', kind: 'benign', what: 'add rate limit to login', edits: [{ file: 'src/routes/auth/login.post.js', from: "  auth: 'public',", to: "  auth: 'public',\n  rateLimit: '20/min'," }] },
  { id: 'B09', kind: 'benign', what: 'change rounding of order total', edits: [{ file: OP, from: 'Math.round(product.price * c.body.quantity * 100) / 100', to: 'Number((product.price * c.body.quantity).toFixed(2))' }] },
  { id: 'B10', kind: 'benign', what: 'new POST /posts, author taken from c.user', edits: [{ file: 'src/routes/posts/index.post.js', create: `import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  body: t.object({ title: t.string({ min: 1, max: 200 }), body: t.string({ max: 5000 }) }),
  response: t.object({ id: t.string(), title: t.string(), authorId: t.string() }),
  handler: (c) => c.created({ id: 'new', title: c.body.title, authorId: c.user.id }),
})
` }] },
]
