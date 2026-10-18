import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => c.json({ error: 'Internal server error' }, 500))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES = 5

// Failed-attempt state per email (lowercased): timestamps of recent failures, and the
// time until which the email is locked (0 when not locked).
const attempts = new Map()

// The JSON body if it is an object, otherwise undefined.
const readBody = async (c) => {
  try {
    const data = await c.req.json()
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : undefined
  } catch {
    return undefined
  }
}

app.post('/auth/login', async (c) => {
  const input = await readBody(c)
  if (!input) return c.json({ error: 'Request body must be a JSON object' }, 400)

  const { email, password } = input
  if (typeof email !== 'string' || !EMAIL.test(email)) {
    return c.json({ error: 'email must be a valid email address' }, 400)
  }
  if (typeof password !== 'string' || password.length < 1 || password.length > 200) {
    return c.json({ error: 'password must be a string of 1 to 200 characters' }, 400)
  }

  const key = email.toLowerCase()
  const now = Date.now()
  let record = attempts.get(key)
  if (record?.lockedUntil) {
    if (record.lockedUntil > now) {
      return c.json({ error: 'Too many failed attempts. Try again later.' }, 429)
    }
    attempts.delete(key)
    record = undefined
  }

  const user = db.users.findByEmail(email)
  if (user && db.verifyPassword(user, password)) {
    return c.json({ token: db.sessions.create(user.id) }, 200)
  }

  const times = (record?.times ?? []).filter((t) => now - t < WINDOW_MS)
  times.push(now)
  if (times.length >= MAX_FAILURES) {
    attempts.set(key, { times: [], lockedUntil: now + WINDOW_MS })
  } else {
    attempts.set(key, { times, lockedUntil: 0 })
  }
  return c.json({ error: 'Invalid email or password' }, 401)
})

export default app
