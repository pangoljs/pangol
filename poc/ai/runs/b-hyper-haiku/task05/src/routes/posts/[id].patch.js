import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { postView } from './_schemas.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  body: t.object({
    title: t.string({ min: 1, max: 200 }).optional(),
    body: t.string({ max: 10000 }).optional(),
  }),
  response: postView,
  handler: (c) => {
    const patch = {}
    if (c.body.title !== undefined) patch.title = c.body.title
    if (c.body.body !== undefined) patch.body = c.body.body
    if (Object.keys(patch).length === 0) return c.fail(400, 'send title and/or body to update')

    const post = db.posts.get(c.params.id)
    if (!post) return c.fail(404, 'post not found')
    const canEdit = post.authorId === c.user.id || c.user.permissions.includes('posts:moderate')
    if (!canEdit) return c.fail(403, 'forbidden')

    // Only title and body can change here; authorId and published are never taken from the client.
    return db.posts.update(post.id, patch)
  },
})
