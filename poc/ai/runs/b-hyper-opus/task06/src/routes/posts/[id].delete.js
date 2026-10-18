import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { canManage } from './_post.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string({ min: 1, max: 64 }) }),
  response: t.empty(),
  handler: (c) => {
    const post = db.posts.get(c.params.id)
    if (!post) return c.fail(404, 'post not found')
    if (!canManage(c.user, post)) return c.fail(403, 'forbidden')
    db.posts.delete(post.id)
    return c.noContent()
  },
})
