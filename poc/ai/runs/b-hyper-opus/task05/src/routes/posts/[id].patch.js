import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { postSchema, canManage } from './_post.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string({ min: 1, max: 64 }) }),
  body: t.object({
    title: t.string({ min: 1, max: 200 }).optional(),
    body: t.string({ max: 20000 }).optional(),
  }),
  response: postSchema,
  handler: (c) => {
    const post = db.posts.get(c.params.id)
    if (!post) return c.fail(404, 'post not found')
    if (!canManage(c.user, post)) return c.fail(403, 'forbidden')
    const patch = {}
    if (c.body.title !== undefined) {
      const title = c.body.title.trim()
      if (!title) return c.fail(400, 'title must not be empty')
      patch.title = title
    }
    if (c.body.body !== undefined) patch.body = c.body.body
    if (Object.keys(patch).length === 0) return c.fail(400, 'provide title and/or body')
    return db.posts.update(post.id, patch)
  },
})
