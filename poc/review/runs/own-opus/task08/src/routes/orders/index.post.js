import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  rateLimit: '30/min',
  body: t.object({
    productId: t.string({ min: 1, max: 64 }),
    quantity: t.int({ min: 1, max: 10 }),
  }),
  response: t.object({
    id: t.string(),
    userId: t.string(),
    productId: t.string(),
    quantity: t.int(),
    total: t.number(),
  }),
  handler: (c) => {
    const { productId, quantity } = c.body
    const product = db.products.get(productId)
    if (!product) return c.fail(404, 'product not found')
    // Price comes from the server-side record, never from the client. Round to cents.
    const total = Math.round(product.price * 100 * quantity) / 100
    if (!db.products.takeStock(product.id, quantity)) return c.fail(409, 'not enough stock')
    const order = db.orders.create({ userId: c.user.id, productId: product.id, quantity, total })
    return c.created(order) // paymentToken is stripped by `response`
  },
})
