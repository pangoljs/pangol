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

app.get('/orders/:id', (c) => {
  const u = authUser(c)
  if (!u) return err(c, 401, 'Unauthorized')
  const o = db.orders.get(c.req.param('id'))
  if (!o) return err(c, 404, 'Order not found')
  if (o.userId !== u.id) return err(c, 403, 'Forbidden')
  return c.json({ id: o.id, productId: o.productId, quantity: o.quantity, total: o.total })
})

export default app
