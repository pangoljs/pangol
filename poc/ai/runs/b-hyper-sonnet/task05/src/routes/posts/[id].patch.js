import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  body: t.object({
    title: t.string({ min: 1, max: 200 }).optional(),
    body: t.string({ min: 1, max: 20000 }).optional(),
  }),
  response: t.object({ id: t.string(), authorId: t.string(), title: t.string(), body: t.string(), published: t.bool() }),
  handler: (c) => {
    const post = db.posts.get(c.params.id)
    if (!post) return c.fail(404, 'post not found')
    const isAuthor = post.authorId === c.user.id
    const isModerator = c.user.permissions.includes('posts:moderate')
    if (!isAuthor && !isModerator) return c.fail(403, 'forbidden')
    const patch = {}
    if (c.body.title !== undefined) patch.title = c.body.title
    if (c.body.body !== undefined) patch.body = c.body.body
    if (Object.keys(patch).length === 0) return c.fail(400, 'nothing to update')
    return db.posts.update(post.id, patch)
  },
})
