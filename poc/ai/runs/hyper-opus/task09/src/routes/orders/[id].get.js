import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  response: t.object({ id: t.string(), productId: t.string(), quantity: t.int(), total: t.number() }),
  handler: (c) => {
    const o = db.orders.get(c.params.id)
    if (!o) return c.fail(404, 'order not found')
    if (o.userId !== c.user.id) return c.fail(403, 'forbidden')
    return { id: o.id, productId: o.productId, quantity: o.quantity, total: o.total }
  },
})
