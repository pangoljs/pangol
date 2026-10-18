import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { orderSchema } from './_order.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string({ min: 1, max: 64 }) }),
  response: orderSchema,
  handler: (c) => {
    const order = db.orders.get(c.params.id)
    // Same answer for "missing" and "someone else's" so order IDs cannot be probed.
    if (!order || order.userId !== c.user.id) return c.fail(404, 'order not found')
    return order
  },
})
