import { route, t } from 'hyperflat'
import { db } from '../../db.js'
export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  response: t.object({ id: t.string(), productId: t.string(), quantity: t.int(), total: t.number() }),
  handler: (c) => {
    const order = db.orders.get(c.params.id)
    if (!order || order.userId !== c.user.id) return c.fail(404, 'order not found')
    return order
  },
})
