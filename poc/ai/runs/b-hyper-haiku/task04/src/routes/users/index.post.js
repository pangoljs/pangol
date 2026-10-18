import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { publicUser } from './_schemas.js'

export default route({
  auth: { permission: 'users:write' },
  body: t.object({
    name: t.string({ min: 1, max: 100 }),
    email: t.email({ max: 254 }),
  }),
  response: publicUser,
  handler: (c) => {
    const name = c.body.name.trim()
    if (!name) return c.fail(400, 'name must not be blank')
    const email = c.body.email.trim().toLowerCase()
    if (db.users.findByEmail(email)) return c.fail(409, 'a user with this email already exists')
    // New users are regular members; they get no permissions and no password yet.
    return c.created(db.users.create({ name, email, role: 'member' }))
  },
})
