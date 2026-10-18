import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

const err = (c, status, message) => c.json({ error: message }, status)
const authUser = (c) => {
  const h = c.req.header('authorization')
  if (!h) return undefined
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h)
  if (!m) return undefined
  return db.sessions.userForToken(m[1])
}
const readBody = async (c) => {
  try {
    const b = await c.req.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? b : undefined
  } catch {
    return undefined
  }
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL.test(s)

const WINDOW = 15 * 60 * 1000
const MAX_FAILS = 5
const fails = new Map()

app.post('/auth/login', async (c) => {
  const b = await readBody(c)
  if (!b) return err(c, 400, 'Invalid body')
  if (!isEmail(b.email)) return err(c, 400, 'Invalid email')
  if (typeof b.password !== 'string' || b.password.length < 1 || b.password.length > 200) return err(c, 400, 'Invalid password')
  const key = b.email.toLowerCase()
  const now = Date.now()
  const recent = (fails.get(key) ?? []).filter((t) => now - t < WINDOW)
  fails.set(key, recent)
  if (recent.length >= MAX_FAILS) return err(c, 429, 'Too many attempts')
  const user = db.users.findByEmail(b.email)
  if (!user || !db.verifyPassword(user, b.password)) {
    recent.push(now)
    return err(c, 401, 'Invalid email or password')
  }
  fails.delete(key)
  return c.json({ token: db.sessions.create(user.id) })
})

export default app
