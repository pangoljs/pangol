import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'optional',
  query: t.object({
    authorId: t.string({ min: 1, max: 64 }).optional(),
    limit: t.int({ min: 1, max: 100 }).default(20),
    offset: t.int({ min: 0 }).default(0),
  }),
  response: t.array(t.object({
    id: t.string(),
    authorId: t.string(),
    title: t.string(),
    body: t.string(),
    published: t.bool(),
  })),
  handler: (c) => {
    const viewerId = c.user ? c.user.id : null
    const { authorId, limit, offset } = c.query
    return db.posts.all()
      // Drafts are visible to their author only.
      .filter((p) => p.published === true || (viewerId !== null && p.authorId === viewerId))
      .filter((p) => authorId === undefined || p.authorId === authorId)
      .sort((a, b) => Number(a.id) - Number(b.id))
      .slice(offset, offset + limit)
  },
})
