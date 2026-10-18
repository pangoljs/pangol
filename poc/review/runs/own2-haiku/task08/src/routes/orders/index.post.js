import { route, t } from 'hyperflat'
import { db } from '../../db.js'

const MAX_QUANTITY = 10

// A signed-in customer orders a product. The total is computed from the current price,
// rounded to cents. Stock is taken atomically (the db call checks and removes in one step).
export default route({
  auth: 'user',
  body: t.object({
    productId: t.string({ min: 1, max: 20 }),
    quantity: t.int({ min: 1, max: MAX_QUANTITY }),
  }),
  response: t.object({
    id: t.string(),
    userId: t.string(),
    productId: t.string(),
    quantity: t.int(),
    total: t.number(),
  }),
  handler: (c) => {
    const product = db.products.get(c.body.productId)
    if (!product) return c.fail(400, 'unknown product')
    if (!db.products.takeStock(product.id, c.body.quantity)) {
      return c.fail(400, 'not enough stock')
    }
    const total = Math.round(product.price * c.body.quantity * 100) / 100
    return c.created(
      db.orders.create({
        userId: c.user.id,
        productId: product.id,
        quantity: c.body.quantity,
        total,
      }),
    )
  },
})
