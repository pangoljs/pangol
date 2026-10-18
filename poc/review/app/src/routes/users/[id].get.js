import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: { permission: 'users:read' },
  params: t.object({ id: t.string() }),
  load: (c) => db.users.get(c.params.id),
  owner: 'none', // staff with users:read may look up any user
  response: t.object({ id: t.string(), name: t.string(), email: t.email(), role: t.string() }),
  handler: (c) => c.resource,
})
