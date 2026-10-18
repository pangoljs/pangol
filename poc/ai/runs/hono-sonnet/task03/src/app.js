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

app.get('/users/:id', (c) => {
  const u = authUser(c)
  if (!u) return err(c, 401, 'Unauthorized')
  if (!u.permissions.includes('users:read')) return err(c, 403, 'Forbidden')
  const x = db.users.get(c.req.param('id'))
  if (!x) return err(c, 404, 'User not found')
  return c.json({ id: x.id, name: x.name, email: x.email, role: x.role })
})

export default app
