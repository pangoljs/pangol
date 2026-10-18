import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { publicUser } from './_schemas.js'

export default route({
  auth: { permission: 'users:read' },
  params: t.object({ id: t.string() }),
  response: publicUser,
  handler: (c) => {
    const user = db.users.get(c.params.id)
    if (!user) return c.fail(404, 'user not found')
    return user
  },
})
