import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

const err = (c, status, error) => c.json({ error }, status)

// Returns { user } on success, or { status } (401) when header missing or token invalid.
const authenticate = (c) => {
  const h = c.req.header('Authorization')
  if (h === undefined) return { status: 401, missing: true }
  const m = /^Bearer[ ]+(\S+)\s*$/i.exec(h.trim())
  if (!m) return { status: 401 }
  const user = db.sessions.userForToken(m[1])
  if (!user) return { status: 401 }
  return { user }
}

const requireUser = (c) => {
  const a = authenticate(c)
  if (!a.user) return { res: err(c, 401, 'Unauthorized') }
  return { user: a.user }
}

const readBody = async (c) => {
  try {
    const b = await c.req.json()
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return undefined
    return b
  } catch {
    return undefined
  }
}

const isEmail = (s) =>
  typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s)

app.notFound((c) => err(c, 404, 'Not found'))
app.onError((e, c) => err(c, 500, 'Internal server error'))

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILS = 5
// email (lowercased) -> { fails: number[] (timestamps), lockedUntil: number }
const attempts = new Map()

app.post('/auth/login', async (c) => {
  const body = await readBody(c)
  if (!body) return err(c, 400, 'Invalid JSON body')
  const { email, password } = body
  if (!isEmail(email)) return err(c, 400, 'email must be a valid email address')
  if (typeof password !== 'string' || password.length < 1 || password.length > 200)
    return err(c, 400, 'password must be a string of 1-200 characters')

  const key = email.toLowerCase()
  const now = Date.now()
  const rec = attempts.get(key) ?? { fails: [], lockedUntil: 0 }
  if (rec.lockedUntil > now) return err(c, 429, 'Too many failed attempts, try again later')
  rec.fails = rec.fails.filter((t) => now - t < WINDOW_MS)

  const user = db.users.findByEmail(email)
  if (!user || !db.verifyPassword(user, password)) {
    rec.fails.push(now)
    if (rec.fails.length >= MAX_FAILS) {
      rec.lockedUntil = now + WINDOW_MS
      rec.fails = []
    }
    attempts.set(key, rec)
    return err(c, 401, 'Invalid email or password')
  }
  attempts.delete(key)
  return c.json({ token: db.sessions.create(user.id) })
})

export default app
