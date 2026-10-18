import { route, t } from 'hyperflat'
import { db } from '../../db.js'

// Customers may read their own orders. Other callers get 404.
export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.orders.get(c.params.id),
  owner: (c, order) => order.userId === c.user.id,
  response: t.object({
    id: t.string(),
    userId: t.string(),
    productId: t.string(),
    quantity: t.int(),
    total: t.number(),
  }),
  handler: (c) => c.resource,
})
