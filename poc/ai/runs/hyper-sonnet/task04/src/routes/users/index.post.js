import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: { permission: 'users:write' },
  body: t.object({ name: t.string({ min: 1, max: 100 }), email: t.email() }),
  response: t.object({ id: t.string(), name: t.string(), email: t.email(), role: t.string() }),
  handler: (c) => {
    if (db.users.findByEmail(c.body.email)) return c.fail(409, 'email already exists')
    return c.created(db.users.create({ name: c.body.name, email: c.body.email, role: 'member', permissions: [] }))
  },
})
