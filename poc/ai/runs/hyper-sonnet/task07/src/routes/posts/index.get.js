import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'optional',
  query: t.object({ authorId: t.string().optional() }),
  response: t.array(t.object({ id: t.string(), title: t.string(), authorId: t.string() })),
  handler: (c) => {
    let posts = db.posts.all().filter((p) => p.published || (c.user && p.authorId === c.user.id))
    if (c.query.authorId !== undefined) posts = posts.filter((p) => p.authorId === c.query.authorId)
    return posts
  },
})
