import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { postSchema } from './_post.js'

export default route({
  auth: 'optional',
  query: t.object({
    authorId: t.string({ min: 1, max: 64 }).optional(),
    limit: t.int({ min: 1, max: 100 }).default(20),
  }),
  response: t.array(postSchema),
  handler: (c) => {
    const viewerId = c.user ? c.user.id : null
    return db.posts
      .all()
      // Drafts are visible only to their own author.
      .filter((p) => p.published || p.authorId === viewerId)
      .filter((p) => c.query.authorId === undefined || p.authorId === c.query.authorId)
      .slice(0, c.query.limit)
  },
})
