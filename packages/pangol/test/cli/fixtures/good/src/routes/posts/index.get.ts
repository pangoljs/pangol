import { route, t } from '../../../../../../../src/index.js'
import { Post, posts } from '../../models.js'

export default route({
  auth: 'user',
  query: t.object({ limit: t.int({ min: 1, max: 50 }).default(20) }),
  response: t.array(Post.public()),
  handler: (c) => [...posts.values()].filter((p) => p.authorId === c.user.id).slice(0, c.query.limit),
})
