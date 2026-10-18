import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.orders.get(c.params.id),
  owner: (c, order) => order.userId === c.user.id,
  response: t.object({ id: t.string(), productId: t.string(), quantity: t.int(), total: t.number() }),
  handler: (c) => c.resource,
})
