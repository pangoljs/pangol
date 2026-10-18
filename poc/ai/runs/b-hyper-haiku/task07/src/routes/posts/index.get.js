import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { postView } from './_schemas.js'

export default route({
  auth: 'optional',
  query: t.object({
    authorId: t.string().optional(),
    limit: t.int({ min: 1, max: 100 }).default(20),
  }),
  response: t.array(postView),
  handler: (c) => {
    const viewer = c.user ? c.user.id : null
    return db.posts
      .all()
      // drafts are only visible to their author
      .filter((p) => p.published || (viewer !== null && p.authorId === viewer))
      .filter((p) => c.query.authorId === undefined || p.authorId === c.query.authorId)
      .slice(0, c.query.limit)
  },
})
