import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { userSchema } from '../_user.js'

export default route({
  auth: { permission: 'users:read' },
  params: t.object({ id: t.string({ min: 1, max: 64 }) }),
  response: userSchema,
  handler: (c) => {
    const user = db.users.get(c.params.id)
    if (!user) return c.fail(404, 'user not found')
    return user
  },
})
