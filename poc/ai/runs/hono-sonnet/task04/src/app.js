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

app.post('/users', async (c) => {
  const u = authUser(c)
  if (!u) return err(c, 401, 'Unauthorized')
  if (!u.permissions.includes('users:write')) return err(c, 403, 'Forbidden')
  const b = await readBody(c)
  if (!b) return err(c, 400, 'Invalid body')
  if (typeof b.name !== 'string' || b.name.length < 1 || b.name.length > 100) return err(c, 400, 'Invalid name')
  if (!isEmail(b.email)) return err(c, 400, 'Invalid email')
  if (db.users.findByEmail(b.email)) return err(c, 409, 'Email already exists')
  const x = db.users.create({ name: b.name, email: b.email, role: 'member', permissions: [] })
  return c.json({ id: x.id, name: x.name, email: x.email, role: x.role }, 201)
})

export default app
