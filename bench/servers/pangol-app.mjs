// The benchmark API in pangol.
import { createApp, defineAuth, route, t } from 'pangol'
import { canRead, sessions, users } from '../shared/data.mjs'

const User = t.model({
  id: t.string({ min: 1, max: 10, pattern: /^[0-9]+$/ }),
  name: t.string({ min: 1, max: 100 }),
  email: t.email({ max: 200 }),
  age: t.int({ min: 0, max: 150 }),
  passwordHash: t.string().private(),
})

export const app = createApp({
  auth: defineAuth({ from: 'bearer', resolve: (req) => sessions.get(req.credential) ?? null }),
  log: () => {},
  routes: {
    'GET /health': route({ auth: 'public', response: t.object({ ok: t.bool() }), handler: () => ({ ok: true }) }),
    'GET /users/:id': route({
      auth: { permission: 'users:read' },
      params: User.pick('id'),
      load: (c) => users.get(c.params.id),
      owner: (c, user) => canRead(c.user, user),
      response: User.pick('id', 'name', 'email'),
      handler: (c) => c.resource,
    }),
    'POST /users': route({
      auth: { permission: 'users:write' },
      body: User.pick('name', 'email', 'age'),
      response: User.pick('id', 'name', 'email', 'age'),
      handler: (c) => c.created({ id: '1001', ...c.body }),
    }),
  },
})
