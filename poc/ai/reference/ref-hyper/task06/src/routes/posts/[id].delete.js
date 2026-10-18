import { route, t } from 'hyperflat'
import { db } from '../../db.js'
export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  response: t.empty(),
  handler: (c) => {
    const post = db.posts.get(c.params.id)
    if (!post) return c.fail(404, 'post not found')
    if (post.authorId !== c.user.id && !c.user.permissions.includes('posts:moderate')) return c.fail(403, 'forbidden')
    db.posts.delete(post.id)
    return c.noContent()
  },
})
