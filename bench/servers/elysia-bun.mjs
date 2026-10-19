// The benchmark API in idiomatic Elysia: TypeBox schemas (compiled by Elysia), beforeHandle for auth,
// a response schema (Elysia drops undeclared fields).
import { Elysia, t } from 'elysia'
import { canRead, sessions, users } from '../shared/data.mjs'

const requirePerm = (perm) => ({ headers, status, store }) => {
  const h = headers.authorization
  if (!h || !h.startsWith('Bearer ')) return status(401, { error: 'unauthorized' })
  const user = sessions.get(h.slice(7))
  if (!user) return status(401, { error: 'unauthorized' })
  if (!user.permissions.includes(perm)) return status(403, { error: 'forbidden' })
  store.user = user
}
const UserOut = t.Object({ id: t.String(), name: t.String(), email: t.String() })
const Body = t.Object({ name: t.String({ minLength: 1, maxLength: 100 }), email: t.String({ format: 'email', maxLength: 200 }), age: t.Integer({ minimum: 0, maximum: 150 }) })

new Elysia()
  .state('user', null)
  .get('/health', () => ({ ok: true }))
  .get('/users/:id', ({ params, status, store }) => {
    const u = users.get(params.id)
    return u && canRead(store.user, u) ? u : status(404, { error: 'not found' })
  }, {
    beforeHandle: requirePerm('users:read'),
    params: t.Object({ id: t.String({ minLength: 1, maxLength: 10, pattern: '^[0-9]+$' }) }),
    response: { 200: UserOut, 404: t.Object({ error: t.String() }) },
  })
  .post('/users', ({ body, status }) => status(201, { id: '1001', ...body }), {
    beforeHandle: requirePerm('users:write'),
    body: Body,
    response: { 201: t.Object({ id: t.String(), name: t.String(), email: t.String(), age: t.Integer() }) },
  })
  .listen(Number(process.env.PORT ?? 3000))
