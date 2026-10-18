import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string({ min: 1, max: 64 }) }),
  load: (c) => db.orders.get(c.params.id),
  owner: (c, order) => order.userId === c.user.id, // other users' orders -> 404
  response: t.object({
    id: t.string(),
    userId: t.string(),
    productId: t.string(),
    quantity: t.int(),
    total: t.number(),
  }),
  handler: (c) => c.resource, // paymentToken is stripped by `response`
})
