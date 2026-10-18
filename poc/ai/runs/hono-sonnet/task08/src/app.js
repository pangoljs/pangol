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

app.post('/orders', async (c) => {
  const u = authUser(c)
  if (!u) return err(c, 401, 'Unauthorized')
  const b = await readBody(c)
  if (!b) return err(c, 400, 'Invalid body')
  if (typeof b.productId !== 'string' || b.productId === '') return err(c, 400, 'Invalid productId')
  if (!Number.isInteger(b.quantity) || b.quantity < 1 || b.quantity > 10) return err(c, 400, 'Invalid quantity')
  const p = db.products.get(b.productId)
  if (!p) return err(c, 404, 'Product not found')
  if (!db.products.takeStock(p.id, b.quantity)) return err(c, 409, 'Insufficient stock')
  const total = Math.round(p.price * b.quantity * 100) / 100
  const o = db.orders.create({ userId: u.id, productId: p.id, quantity: b.quantity, total })
  return c.json({ id: o.id, productId: o.productId, quantity: o.quantity, total: o.total }, 201)
})

export default app
