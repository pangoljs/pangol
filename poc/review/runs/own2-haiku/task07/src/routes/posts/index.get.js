import { route, t } from 'hyperflat'
import { db } from '../../db.js'

// Published posts are visible to everyone. Drafts are visible only to their author.
// Optional ?author=<userId> filters by author.
export default route({
  auth: 'optional',
  query: t.object({
    author: t.string({ max: 20 }).optional(),
    limit: t.int({ min: 1, max: 100 }).default(20),
  }),
  response: t.array(
    t.object({
      id: t.string(),
      authorId: t.string(),
      title: t.string(),
      body: t.string(),
      published: t.bool(),
    }),
  ),
  handler: (c) => {
    const viewerId = c.user?.id
    return db.posts
      .all()
      .filter((p) => (c.query.author === undefined || p.authorId === c.query.author))
      .filter((p) => p.published || (viewerId !== undefined && p.authorId === viewerId))
      .slice(0, c.query.limit)
  },
})
