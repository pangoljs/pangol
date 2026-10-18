import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'optional',
  query: t.object({ authorId: t.string().optional() }),
  response: t.array(t.object({ id: t.string(), title: t.string(), authorId: t.string() })),
  handler: (c) => {
    const me = c.user ? c.user.id : null
    return db.posts
      .all()
      .filter((p) => p.published === true || (me !== null && p.authorId === me))
      .filter((p) => c.query.authorId === undefined || p.authorId === c.query.authorId)
      .map((p) => ({ id: p.id, title: p.title, authorId: p.authorId }))
  },
})
