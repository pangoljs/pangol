import { route, t } from 'hyperflat'
import { db } from '../../db.js'

// Same rule as editing: the author or a moderator (posts:moderate) may delete a post.
export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.posts.get(c.params.id),
  owner: (c, post) => post.authorId === c.user.id || c.user.permissions.includes('posts:moderate'),
  response: t.empty(),
  handler: (c) => {
    db.posts.delete(c.resource.id)
    return c.noContent()
  },
})
