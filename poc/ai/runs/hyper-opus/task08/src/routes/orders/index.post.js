import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  body: t.object({ productId: t.string(), quantity: t.int({ min: 1, max: 10 }) }),
  response: t.object({ id: t.string(), productId: t.string(), quantity: t.int(), total: t.number() }),
  handler: (c) => {
    const { productId, quantity } = c.body
    const product = db.products.get(productId)
    if (!product) return c.fail(404, 'product not found')
    if (!db.products.takeStock(product.id, quantity)) return c.fail(409, 'not enough stock')
    const total = Math.round(product.price * quantity * 100) / 100
    const o = db.orders.create({ userId: c.user.id, productId: product.id, quantity, total })
    return c.created({ id: o.id, productId: o.productId, quantity: o.quantity, total: o.total })
  },
})
