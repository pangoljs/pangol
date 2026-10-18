import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  response: t.empty(),
  handler: (c) => {
    const post = db.posts.get(c.params.id)
    if (!post) return c.fail(404, 'post not found')
    const isAuthor = post.authorId === c.user.id
    const isModerator = c.user.permissions.includes('posts:moderate')
    if (!isAuthor && !isModerator) return c.fail(403, 'forbidden')
    db.posts.delete(post.id)
    return c.noContent()
  },
})
