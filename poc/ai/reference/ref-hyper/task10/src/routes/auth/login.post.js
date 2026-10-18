import { route, t } from 'hyperflat'
import { db } from '../../db.js'
const WINDOW = 15 * 60 * 1000
const failures = new Map() // email -> timestamps of failed attempts
export default route({
  auth: 'public',
  body: t.object({ email: t.email(), password: t.string({ min: 1, max: 200 }) }),
  response: t.object({ token: t.string() }),
  handler: (c) => {
    const key = c.body.email.toLowerCase()
    const now = Date.now()
    const recent = (failures.get(key) ?? []).filter((ts) => now - ts < WINDOW)
    failures.set(key, recent)
    if (recent.length >= 5) return c.fail(429, 'too many attempts')
    const user = db.users.findByEmail(key)
    if (!user || !db.verifyPassword(user, c.body.password)) { recent.push(now); return c.fail(401, 'invalid email or password') }
    return { token: db.sessions.create(user.id) }
  },
})
