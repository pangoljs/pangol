import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: { permission: 'users:read' },
  params: t.object({ id: t.string() }),
  response: t.object({ id: t.string(), name: t.string(), email: t.string(), role: t.string() }),
  handler: (c) => {
    const u = db.users.get(c.params.id)
    if (!u) return c.fail(404, 'user not found')
    return { id: u.id, name: u.name, email: u.email, role: u.role }
  },
})
