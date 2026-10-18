import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: { permission: 'users:read' },
  params: t.object({ id: t.string() }),
  response: t.object({ id: t.string(), name: t.string(), email: t.email(), role: t.string() }),
  handler: (c) => {
    const user = db.users.get(c.params.id)
    if (!user) return c.fail(404, 'user not found')
    return user
  },
})
