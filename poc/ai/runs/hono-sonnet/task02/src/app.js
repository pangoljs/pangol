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

app.get('/users', (c) => {
  const u = authUser(c)
  if (!u) return err(c, 401, 'Unauthorized')
  if (!u.permissions.includes('users:read')) return err(c, 403, 'Forbidden')
  let limit = 20
  const raw = c.req.query('limit')
  if (raw !== undefined) {
    if (!/^\d+$/.test(raw)) return err(c, 400, 'Invalid limit')
    limit = Number(raw)
    if (limit < 1 || limit > 100) return err(c, 400, 'Invalid limit')
  }
  return c.json(db.users.all().slice(0, limit).map((x) => ({ id: x.id, name: x.name, email: x.email })))
})

export default app
