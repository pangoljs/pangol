import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { orderView } from './_schemas.js'

const MAX_QUANTITY_PER_ORDER = 10

export default route({
  auth: 'user',
  body: t.object({
    productId: t.string(),
    quantity: t.int({ min: 1, max: MAX_QUANTITY_PER_ORDER }),
  }),
  response: orderView,
  handler: (c) => {
    const product = db.products.get(c.body.productId)
    if (!product) return c.fail(404, 'product not found')

    // Total in cents-precision to avoid floating point drift (e.g. 9.99 * 3).
    const total = Math.round(product.price * c.body.quantity * 100) / 100

    if (!db.products.takeStock(product.id, c.body.quantity)) {
      return c.fail(409, 'not enough stock')
    }

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
