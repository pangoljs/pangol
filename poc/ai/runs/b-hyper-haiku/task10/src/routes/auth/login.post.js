import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { lockout } from '../../lockout.js'

export default route({
  auth: 'public',
  // per client IP and user: caps request volume from a single source
  rateLimit: '10/min',
  body: t.object({
    email: t.email({ max: 254 }),
    password: t.string({ min: 1, max: 200 }),
  }),
  response: t.object({ token: t.string() }),
  handler: (c) => {
    const key = c.body.email.trim().toLowerCase()
    const now = Date.now()

    // per account: stops password guessing spread across many IPs
    const lockedMs = lockout.lockedFor(key, now)
    if (lockedMs > 0) {
      const minutes = Math.ceil(lockedMs / 60000)
      return c.fail(429, `too many failed attempts, try again in ${minutes} minute(s)`)
    }

    const user = db.users.findByEmail(key)
    if (!db.verifyPassword(user, c.body.password)) {
      lockout.recordFailure(key, now)
      // same message for unknown email and wrong password: no account enumeration
      return c.fail(401, 'invalid email or password')
    }

    lockout.reset(key)
    return { token: db.sessions.create(user.id) }
  },
})
