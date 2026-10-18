import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'optional',
  query: t.object({ authorId: t.string().optional() }),
  response: t.array(t.object({ id: t.string(), title: t.string(), authorId: t.string() })),
  handler: (c) => db.posts.all()
    .filter((p) => p.published || (c.user && p.authorId === c.user.id))
    .filter((p) => c.query.authorId === undefined || p.authorId === c.query.authorId),
})
