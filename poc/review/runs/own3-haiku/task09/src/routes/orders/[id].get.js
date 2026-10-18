import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { order } from './_schemas.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.orders.get(c.params.id),
  owner: (c, item) => item.userId === c.user.id,
  response: order,
  handler: (c) => c.resource,
})
