import { route, t } from 'hyperflat'
import { db } from '../../db.js'

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5

// email (lower-cased) -> { failures: number[] (timestamps), lockedUntil: number }
const attempts = new Map()

const keyFor = (email) => email.toLowerCase()

export default route({
  auth: 'public',
  body: t.object({
    email: t.email(),
    password: t.string({ min: 1, max: 200 }),
  }),
  response: t.object({ token: t.string() }),
  handler: (c) => {
    const key = keyFor(c.body.email)
    const now = Date.now()
    const record = attempts.get(key) ?? { failures: [], lockedUntil: 0 }

    if (record.lockedUntil > now) return c.fail(429, 'too many failed attempts, try again later')

    const user = db.users.findByEmail(c.body.email)
    if (!db.verifyPassword(user, c.body.password)) {
      record.failures = record.failures.filter((at) => now - at < WINDOW_MS)
      record.failures.push(now)
      if (record.failures.length >= MAX_FAILURES) {
        record.lockedUntil = now + WINDOW_MS
        record.failures = []
      }
      attempts.set(key, record)
      return c.fail(401, 'invalid email or password')
    }

    attempts.delete(key)
    return { token: db.sessions.create(user.id) }
  },
})
