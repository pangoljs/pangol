import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  body: t.object({
    title: t.string({ min: 1, max: 200 }).optional(),
    body: t.string({ max: 5000 }).optional(),
  }),
  response: t.object({ id: t.string(), title: t.string(), body: t.string(), authorId: t.string() }),
  handler: (c) => {
    if (c.body.title === undefined && c.body.body === undefined) {
      return c.fail(400, 'provide title and/or body')
    }
    const post = db.posts.get(c.params.id)
    if (!post) return c.fail(404, 'post not found')
    const canEdit = post.authorId === c.user.id || c.user.permissions.includes('posts:moderate')
    if (!canEdit) return c.fail(403, 'forbidden')

    const patch = {}
    if (c.body.title !== undefined) patch.title = c.body.title
    if (c.body.body !== undefined) patch.body = c.body.body
    return db.posts.update(post.id, patch)
  },
})
