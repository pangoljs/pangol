import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { isAuthorOrModerator } from '../_guards.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.posts.get(c.params.id),
  owner: isAuthorOrModerator,
  response: t.empty(),
  handler: (c) => {
    db.posts.delete(c.resource.id)
    return c.noContent()
  },
})
