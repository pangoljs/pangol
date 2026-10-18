import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { orderSchema } from './_order.js'

export default route({
  auth: 'user',
  rateLimit: '30/min',
  body: t.object({
    productId: t.string({ min: 1, max: 64 }),
    quantity: t.int({ min: 1, max: 10 }),
  }),
  response: orderSchema,
  handler: (c) => {
    const { productId, quantity } = c.body
    const product = db.products.get(productId)
    if (!product) return c.fail(404, 'product not found')
    // Price comes from the server, never from the client; computed in cents to avoid float drift.
    const total = Math.round(Math.round(product.price * 100) * quantity) / 100
    if (!db.products.takeStock(product.id, quantity)) return c.fail(409, 'not enough stock')
    const order = db.orders.create({ userId: c.user.id, productId: product.id, quantity, total })
    return c.created(order)
  },
})
