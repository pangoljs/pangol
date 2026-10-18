import { route, t } from 'hyperflat'
import { db } from '../../db.js'

const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const failures = new Map() // key -> { count, resetAt }

const keyFor = (email, ip) => `${String(email).toLowerCase()}|${ip}`
const emailKey = (email) => `${String(email).toLowerCase()}|*`

function locked(key) {
  const f = failures.get(key)
  if (!f) return false
  if (f.resetAt <= Date.now()) {
    failures.delete(key)
    return false
  }
  return f.count >= MAX_FAILURES
}

function recordFailure(key) {
  const f = failures.get(key)
  if (!f || f.resetAt <= Date.now()) failures.set(key, { count: 1, resetAt: Date.now() + WINDOW_MS })
  else f.count += 1
}

export default route({
  auth: 'public',
  rateLimit: '10/min',
  body: t.object({ email: t.email({ max: 254 }), password: t.string({ min: 1, max: 200 }) }),
  response: t.object({ token: t.string() }),
  handler: (c) => {
    const keys = [keyFor(c.body.email, c.ip), emailKey(c.body.email)]
    if (keys.some(locked)) return c.fail(429, 'too many failed attempts, try again later')
    const user = db.users.findByEmail(c.body.email)
    if (!user || !db.verifyPassword(user, c.body.password)) {
      keys.forEach(recordFailure)
      return c.fail(401, 'invalid email or password')
    }
    keys.forEach((k) => failures.delete(k))
    return { token: db.sessions.create(user.id) }
  },
})
