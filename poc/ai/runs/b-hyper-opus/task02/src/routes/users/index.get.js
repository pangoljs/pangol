import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { userSchema } from '../_user.js'

export default route({
  auth: { permission: 'users:read' },
  query: t.object({ limit: t.int({ min: 1, max: 100 }).default(20) }),
  response: t.array(userSchema),
  handler: (c) => db.users.all().slice(0, c.query.limit),
})
