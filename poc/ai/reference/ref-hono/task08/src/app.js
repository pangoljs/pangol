import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from './db.js'

const app = new Hono()
const invalid = (r, c) => { if (!r.success) return c.json({ error: 'invalid input' }, 400) }
const requireUser = (opts = {}) => createMiddleware(async (c, next) => {
  const h = c.req.header('authorization')
  if (!h) { if (opts.optional) { c.set('user', null); return next() } return c.json({ error: 'unauthorized' }, 401) }
  if (!h.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401)
  const user = db.sessions.userForToken(h.slice(7))
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (opts.permission && !user.permissions.includes(opts.permission)) return c.json({ error: 'forbidden' }, 403)
  c.set('user', user)
  await next()
})

app.post('/orders', requireUser(),
  zValidator('json', z.object({ productId: z.string().min(1), quantity: z.number().int().min(1).max(10) }), invalid),
  (c) => {
    const user = c.get('user')
    const { productId, quantity } = c.req.valid('json')
    const product = db.products.get(productId)
    if (!product) return c.json({ error: 'product not found' }, 404)
    if (!db.products.takeStock(product.id, quantity)) return c.json({ error: 'not enough stock' }, 409)
    const total = Math.round(product.price * quantity * 100) / 100
    const o = db.orders.create({ userId: user.id, productId: product.id, quantity, total })
    return c.json({ id: o.id, productId: o.productId, quantity: o.quantity, total: o.total }, 201)
  })
export default app
