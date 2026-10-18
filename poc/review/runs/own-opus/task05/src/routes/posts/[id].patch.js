import { route, t } from 'hyperflat'
import { db } from '../../db.js'

const isModerator = (user) => Array.isArray(user.permissions) && user.permissions.includes('posts:moderate')
const canEdit = (user, post) => post.authorId === user.id || isModerator(user)

export default route({
  auth: 'user',
  params: t.object({ id: t.string({ min: 1, max: 64 }) }),
  body: t.object({
    title: t.string({ min: 1, max: 200 }).optional(),
    body: t.string({ max: 20000 }).optional(),
  }),
  load: (c) => db.posts.get(c.params.id),
  // Others' drafts are hidden entirely (404); published posts are visible, so editing them is a 403.
  owner: (c, post) => post.published || canEdit(c.user, post),
  response: t.object({
    id: t.string(),
    authorId: t.string(),
    title: t.string(),
    body: t.string(),
    published: t.bool(),
  }),
  handler: (c) => {
    const post = c.resource
    if (!canEdit(c.user, post)) return c.fail(403, 'forbidden')

    const patch = {}
    if (c.body.title !== undefined) {
      const title = c.body.title.trim()
      if (!title) return c.fail(400, 'title must not be empty')
      patch.title = title
    }
    if (c.body.body !== undefined) patch.body = c.body.body
    if (Object.keys(patch).length === 0) return c.fail(400, 'provide title and/or body')

    const updated = db.posts.update(post.id, patch)
    if (!updated) return c.fail(404, 'post not found')
    return updated
  },
})
