import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { isLocked, recordFailure } from './_attempts.js'

export default route({
  auth: 'public',
  body: t.object({ email: t.email(), password: t.string({ min: 1, max: 200 }) }),
  response: t.object({ token: t.string() }),
  handler: (c) => {
    const key = c.body.email.trim().toLowerCase()
    if (isLocked(key)) return c.fail(429, 'too many failed attempts, try again later')
    const user = db.users.findByEmail(c.body.email)
    if (!user || !db.verifyPassword(user, c.body.password)) {
      recordFailure(key)
      return c.fail(401, 'invalid email or password')
    }
    return { token: db.sessions.create(user.id) }
  },
})
