import { defineAuth, money, route, t } from '../src/index.js'
import type { Infer } from '../src/index.js'

// Exact equality catches accidental widening to unknown or any.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function exact<A, B>(_equal: Equal<A, B> extends true ? true : never): void {}

const auth = defineAuth({
  from: 'bearer',
  resolve: async (request) => {
    exact<typeof request.credential, string>(true)
    exact<ReturnType<typeof request.cookies.get>, string | undefined>(true)
    // @ts-expect-error the request is read-only
    request.headers.set('x', 'y')
    return { id: 'u1', permissions: ['edit'], name: 'Ada' }
  },
})
defineAuth({ from: { cookie: 'session' }, resolve: () => null })
// @ts-expect-error the credential source is required
defineAuth({ resolve: () => null })
// @ts-expect-error only bearer tokens and named cookies are supported
defineAuth({ from: 'header', resolve: () => null })
// @ts-expect-error resolve returns a user with id and permissions, or null
defineAuth({ from: 'bearer', resolve: () => ({ id: 'u1' }) })
declare module '../src/index.js' {
  interface Register { auth: typeof auth }
}

const post = t.object({ id: t.id(), title: t.string(), published: t.bool() })
route({
  auth: 'user',
  params: t.object({ id: t.id() }),
  query: t.object({ limit: t.int().default(20), tag: t.string().optional() }),
  body: t.object({ title: t.string(), published: t.bool() }),
  response: post,
  load: async (c) => {
    exact<typeof c.params.id, string>(true)
    exact<typeof c.user.name, string>(true)
    // @ts-expect-error resource is only available after load
    c.resource
    return Math.random() > 0.5 ? { id: c.params.id, title: 'Hello', published: false, authorId: 'u1' } : null
  },
  owner: (c, record) => {
    exact<typeof record.authorId, string>(true)
    return record.authorId === c.user.id
  },
  handler: (c) => {
    exact<typeof c.body.published, boolean>(true)
    exact<typeof c.query.limit, number>(true)
    exact<typeof c.query.tag, string | undefined>(true)
    exact<typeof c.resource.authorId, string>(true)
    // @ts-expect-error declared schemas define the available fields
    c.body.role
    return c.created({ ...c.resource, title: c.body.title })
  },
})

route({ auth: 'public', response: t.string(), handler: (c) => {
  // @ts-expect-error public routes cannot read user
  c.user
  // @ts-expect-error no body schema
  c.body
  // @ts-expect-error no query schema
  c.query
  // @ts-expect-error no load
  c.resource
  c.headers.get('accept')
  // @ts-expect-error request headers are read-only
  c.headers.set('authorization', 'Bearer changed')
  return 'healthy'
} })

route({ auth: 'optional', response: t.string(), handler: (c) => {
  exact<typeof c.user, { id: string; permissions: string[]; name: string } | null>(true)
  // @ts-expect-error optional auth must narrow null before reading user
  c.user.id
  return c.user?.name ?? 'guest'
} })

route({ auth: { permission: 'edit' }, response: t.string(), owner: 'query', handler: (c) => c.user.name })
route({ auth: 'public', response: t.empty(), handler: (c) => c.noContent() })
route({ auth: 'user', response: t.string(), handler: (c) => c.fail(404, 'missing') })
route({ auth: 'public', response: t.array(t.enum(['draft', 'published'])), handler: async () => ['draft' as const] })

// @ts-expect-error auth is mandatory
route({ response: t.string(), handler: () => 'ok' })
// @ts-expect-error response is mandatory
route({ auth: 'public', handler: () => 'ok' })
// @ts-expect-error auth mode must be known
route({ auth: 'admin', response: t.string(), handler: () => 'ok' })
// @ts-expect-error output must match response (cannot widen from handler)
route({ auth: 'public', response: t.string(), handler: () => 123 })
// @ts-expect-error async output must also match response
route({ auth: 'public', response: t.string(), handler: async () => 123 })
// @ts-expect-error missing required output fields
route({ auth: 'public', response: post, handler: () => ({ id: 'p1', title: 'Hello' }) })
// @ts-expect-error empty responses must use noContent
route({ auth: 'public', response: t.empty(), handler: () => undefined })
route({ auth: 'public', response: t.string(), handler: (c) => {
  // @ts-expect-error noContent requires an empty response schema
  return c.noContent()
} })
// @ts-expect-error unknown route options are rejected
route({ auth: 'public', response: t.string(), hanlder: () => 'ok', handler: () => 'ok' })
// @ts-expect-error functional owner requires load
route({ auth: 'user', response: t.string(),
  owner: () => true, handler: () => 'ok' })
route({ auth: 'public', response: t.string(), load: () => ({ id: 'p1' }),
  // @ts-expect-error public routes cannot have an owner function
  owner: () => true, handler: () => 'ok' })

// c.fail is for client errors only: success codes would skip response filtering, and a 5xx
// should be a thrown error (logged server-side, generic body).
route({ auth: 'user', response: t.string(), handler: (c) => {
  // @ts-expect-error a success status is not a failure
  c.fail(200, 'ok')
  // @ts-expect-error 5xx comes from a thrown error
  c.fail(500, 'boom')
  return c.fail(409, 'conflict')
} })
// @ts-expect-error params must be an object schema
route({ auth: 'public', params: t.string(), response: t.string(), handler: () => 'ok' })
// @ts-expect-error query must be an object schema
route({ auth: 'public', query: t.int(), response: t.string(), handler: () => 'ok' })
// @ts-expect-error body must be an object schema
route({ auth: 'user', body: t.array(t.string()), response: t.string(), handler: () => 'ok' })
// @ts-expect-error a permission name cannot be empty
route({ auth: { permission: '' }, response: t.string(), handler: () => 'ok' })
// @ts-expect-error an optional response would send 200 with no body; use t.empty() and c.noContent()
route({ auth: 'public', response: t.string().optional(), handler: () => 'ok' })
// @ts-expect-error the same rules apply to routes with load
route({ auth: { permission: '' }, params: t.object({ id: t.id() }), response: t.string(), load: (c) => ({ id: c.params.id }), handler: () => 'ok' })
const permission: string = 'edit'
route({ auth: { permission }, response: t.object({ tag: t.string().optional() }), handler: () => ({}) })

const input = t.object({ name: t.string(), tag: t.string().optional(), active: t.bool().default(true) })
const valid: Infer<typeof input> = { name: 'Ada', active: true }
void valid
// @ts-expect-error defaulted fields are present after validation
const invalid: Infer<typeof input> = { name: 'Ada' }
void invalid
// @ts-expect-error defaults must match the schema
t.int().default('20')
// @ts-expect-error enums must have at least one member
t.enum([])

// money is bigint minor units inside the server; email and uuid are strings
exact<Infer<ReturnType<typeof t.money>>, bigint>(true)
exact<Infer<ReturnType<typeof t.email>>, string>(true)
exact<Infer<ReturnType<typeof t.uuid>>, string>(true)
route({
  auth: 'user',
  body: t.object({ amount: t.money(), to: t.uuid(), email: t.email().optional() }),
  response: t.object({ total: t.money() }),
  handler: (c) => {
    exact<typeof c.body.amount, bigint>(true)
    return { total: money.mul(c.body.amount, '1.07', 'halfEven') }
  },
})
// @ts-expect-error a float can never be returned as money
route({ auth: 'public', response: t.object({ total: t.money() }), handler: () => ({ total: 12.5 }) })
// @ts-expect-error money defaults are minor units, not floats
t.money().default(12.5)
// @ts-expect-error money bounds are decimal strings, not numbers
t.money({ min: 0 })
// @ts-expect-error a factor is a decimal string, never a float
money.mul(100n, 0.07, 'halfEven')
// @ts-expect-error the rounding mode is required
money.div(100n, 3n)

// t.model and .private(): a private field anywhere in a response is a type error (SPEC C10)
// ObjectOutput stays an intersection (flattening it costs ~8% more instantiations at 2,000 routes)
type Out<S extends { output: unknown }> = { [K in keyof S['output']]: S['output'][K] }
const User = t.model({
  id: t.id(),
  name: t.string(),
  email: t.email(),
  role: t.enum(['admin', 'member']).default('member'),
  passwordHash: t.string().private(),
})
exact<Out<typeof User>, { id: string; name: string; email: string; role: 'admin' | 'member'; passwordHash: string }>(true)
exact<Out<ReturnType<typeof User.public>>, { id: string; name: string; email: string; role: 'admin' | 'member' }>(true)
const patch = User.pick('name', 'role').partial()
exact<Out<typeof patch>, { name?: string; role?: 'admin' | 'member' }>(true)
exact<Out<ReturnType<typeof User.omit<'passwordHash' | 'role'>>>, { id: string; name: string; email: string }>(true)
const Team = t.model({ id: t.id(), lead: User, members: t.array(User), profile: t.object({ bio: t.string() }) })
exact<keyof Infer<ReturnType<typeof Team.public>>, 'id' | 'profile'>(true)
declare const row: { id: string; name: string; email: string; role: 'admin' | 'member'; passwordHash: string }
route({ auth: 'public', response: User.public(), handler: () => row })
route({ auth: 'public', response: t.array(User.omit('passwordHash')), handler: () => [row] })
route({ auth: 'user', body: User.pick('name', 'email'), response: User.public(), handler: (c) => ({ ...row, ...c.body }) })
route({ auth: 'user', body: User.pick('passwordHash'), response: t.empty(), handler: (c) => c.noContent() })
// @ts-expect-error the whole model has a private field
route({ auth: 'public', response: User, handler: () => row })
// @ts-expect-error picking a private field into a response
route({ auth: 'public', response: User.pick('name', 'passwordHash'), handler: () => row })
// @ts-expect-error private fields are found when nested
route({ auth: 'public', response: t.object({ user: User }), handler: () => ({ user: row }) })
// @ts-expect-error and inside arrays
route({ auth: 'public', response: t.array(User), handler: () => [row] })
// @ts-expect-error .optional() and .default() keep the private mark
route({ auth: 'public', response: t.object({ token: t.string().private().optional() }), handler: () => ({}) })
// @ts-expect-error the same rule applies to routes with load
route({ auth: 'user', params: t.object({ id: t.id() }), load: () => row, owner: 'none', response: User, handler: (c) => c.resource })
// @ts-expect-error pick only takes keys of the model
User.pick('nmae')
// @ts-expect-error omit too
User.omit('passwrodHash')
