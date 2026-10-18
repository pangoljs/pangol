import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { publicUser } from './_schemas.js'

export default route({
  auth: { permission: 'users:read' },
  query: t.object({
    limit: t.int({ min: 1, max: 100 }).default(20),
  }),
  response: t.array(publicUser),
  handler: (c) => db.users.all().slice(0, c.query.limit),
})
