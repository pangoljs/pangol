import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { post } from './_schemas.js'

export default route({
  auth: 'optional',
  query: t.object({
    authorId: t.string({ min: 1 }).optional(),
  }),
  response: t.array(post),
  handler: (c) =>
    db.posts
      .all()
      .filter((p) => p.published || (c.user !== null && p.authorId === c.user.id))
      .filter((p) => c.query.authorId === undefined || p.authorId === c.query.authorId),
})
