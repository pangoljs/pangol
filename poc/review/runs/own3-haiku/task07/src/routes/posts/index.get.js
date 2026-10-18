import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { post } from './_schemas.js'

export default route({
  auth: 'optional',
  query: t.object({
    authorId: t.string({ min: 1 }).optional(),
  }),
  response: t.array(post),
  handler: (c) => {
    const viewerId = c.user ? c.user.id : null
    return db.posts
      .all()
      .filter((p) => !c.query.authorId || p.authorId === c.query.authorId)
      .filter((p) => p.published || (viewerId !== null && p.authorId === viewerId))
  },
})
