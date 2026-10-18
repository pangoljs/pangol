import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { orderView } from './_schemas.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  response: orderView,
  handler: (c) => {
    const order = db.orders.get(c.params.id)
    if (!order) return c.fail(404, 'order not found')
    if (order.userId !== c.user.id) return c.fail(403, 'forbidden')
    return order
  },
})
