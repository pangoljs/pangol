import { route, t } from 'hyperflat'
import { db } from '../../db.js'

const isModerator = (user) => Array.isArray(user.permissions) && user.permissions.includes('posts:moderate')
const canDelete = (user, post) => post.authorId === user.id || isModerator(user)

export default route({
  auth: 'user',
  params: t.object({ id: t.string({ min: 1, max: 64 }) }),
  load: (c) => db.posts.get(c.params.id),
  // Others' drafts are hidden entirely (404); published posts are visible, so deleting them is a 403.
  owner: (c, post) => post.published || canDelete(c.user, post),
  response: t.empty(),
  handler: (c) => {
    if (!canDelete(c.user, c.resource)) return c.fail(403, 'forbidden')
    if (!db.posts.delete(c.resource.id)) return c.fail(404, 'post not found')
    return c.noContent()
  },
})
