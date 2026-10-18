import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { isLocked, recordFailure, recordSuccess } from './_lockout.js'

export default route({
  auth: 'public',
  rateLimit: '10/min',
  body: t.object({
    email: t.email({ max: 254 }),
    password: t.string({ min: 1, max: 200 }),
  }),
  response: t.object({ token: t.string() }),
  handler: (c) => {
    const { email, password } = c.body
    if (isLocked(email)) return c.fail(429, 'too many failed attempts, try again later')
    const user = db.users.findByEmail(email)
    // Always run the password check and use one generic message, so responses do not reveal
    // whether the email exists.
    const ok = db.verifyPassword(user, password)
    if (!user || !ok) {
      recordFailure(email)
      return c.fail(401, 'invalid email or password')
    }
    recordSuccess(email)
    return { token: db.sessions.create(user.id) }
  },
})
