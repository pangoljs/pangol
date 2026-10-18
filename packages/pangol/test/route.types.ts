import { defineAuth, route, t } from '../src/index.js'
import type { Infer } from '../src/index.js'

const auth = defineAuth({
  resolve: async (_request: Request) => ({ id: 'u1', permissions: ['edit'], name: 'Ada' }),
})
declare module '../src/index.js' {
  interface Register { auth: typeof auth }
}

// Exact equality catches accidental widening to unknown or any.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
function exact<A, B>(_equal: Equal<A, B> extends true ? true : never): void {}

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
