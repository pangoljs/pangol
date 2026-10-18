// What a user of the framework writes (file-based routing is flattened into one list for the PoC).
import { t, route, defineAuth } from '../hyper/t.mjs'
import { users, sessions } from '../shared/data.mjs'

export const auth = defineAuth({
  // bearer token -> user with permission names; the build turns names into bit masks
  resolve: (token) => sessions.get(token),
})

const UserOut = t.object({ id: t.string(), name: t.string(), email: t.email() })

export const routes = [
  ['GET', '/health', route({
    auth: 'public',
    response: t.object({ ok: t.bool() }),
    handler: () => ({ ok: true }),
  })],
  ['GET', '/users/:id', route({
    auth: { permission: 'users:read' },
    params: t.object({ id: t.string({ min: 1, max: 10, pattern: '^[0-9]+$' }) }),
    response: UserOut,
    handler: (c) => users.get(c.params.id) ?? c.fail(404, 'User not found'),
  })],
  ['POST', '/users', route({
    auth: { permission: 'users:write' },
    body: t.object({ name: t.string({ min: 1, max: 100 }), email: t.email({ max: 200 }), age: t.int({ min: 0, max: 150 }) }),
    response: t.object({ id: t.string(), name: t.string(), email: t.email(), age: t.int() }),
    handler: (c) => c.created({ id: '1001', ...c.body }),
  })],
]
