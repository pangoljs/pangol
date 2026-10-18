import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  response: t.empty(),
  load: (c) => db.posts.get(c.params.id),
  // Authors and moderators may delete; anyone else gets 403 (checked in the handler).
  owner: 'none',
  handler: (c) => {
    const isModerator = c.user.permissions.includes('posts:moderate')
    if (c.resource.authorId !== c.user.id && !isModerator) return c.fail(403, 'forbidden')
    db.posts.delete(c.resource.id)
    return c.noContent()
  },
})
