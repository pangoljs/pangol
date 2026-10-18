import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { userSchema } from '../_user.js'

export default route({
  auth: { permission: 'users:write' },
  body: t.object({
    name: t.string({ min: 1, max: 100 }),
    email: t.email({ max: 254 }),
  }),
  response: userSchema,
  handler: (c) => {
    const name = c.body.name.trim()
    const email = c.body.email.trim().toLowerCase()
    if (!name) return c.fail(400, 'name is required')
    if (db.users.findByEmail(email)) return c.fail(409, 'email already in use')
    // New users are always regular members without extra permissions or a password.
    const user = db.users.create({ name, email, role: 'member', permissions: [], passwordHash: null })
    return c.created(user)
  },
})
