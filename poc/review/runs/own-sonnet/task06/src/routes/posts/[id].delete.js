import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.posts.get(c.params.id),
  // authors and moderators only; everyone else gets 404 so ids cannot be probed
  owner: (c, post) => post.authorId === c.user.id || c.user.permissions.includes('posts:moderate'),
  response: t.empty(),
  handler: (c) => {
    db.posts.delete(c.resource.id)
    return c.noContent()
  },
})
