import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'optional',
  query: t.object({ authorId: t.string().optional() }),
  response: t.array(t.object({ id: t.string(), authorId: t.string(), title: t.string(), body: t.string(), published: t.bool() })),
  handler: (c) => {
    const me = c.user ? c.user.id : null
    return db.posts
      .all()
      .filter((p) => p.published || p.authorId === me)
      .filter((p) => c.query.authorId === undefined || p.authorId === c.query.authorId)
  },
})
