import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { order } from './_schemas.js'

export default route({
  auth: 'user',
  body: t.object({
    productId: t.string({ min: 1 }),
    quantity: t.int({ min: 1, max: 10 }),
  }),
  response: order,
  handler: (c) => {
    const product = db.products.get(c.body.productId)
    if (!product) return c.fail(404, 'product not found')
    if (!db.products.takeStock(product.id, c.body.quantity)) return c.fail(409, 'not enough stock')
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
