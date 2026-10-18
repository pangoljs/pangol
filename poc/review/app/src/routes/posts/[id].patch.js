import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { isAuthorOrModerator } from '../_guards.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.posts.get(c.params.id),
  owner: isAuthorOrModerator,
  body: t.object({ title: t.string({ min: 1, max: 200 }).optional(), body: t.string({ max: 5000 }).optional() }),
  response: t.object({ id: t.string(), title: t.string(), body: t.string(), authorId: t.string() }),
  handler: (c) => {
    if (c.body.title === undefined && c.body.body === undefined) return c.fail(400, 'title or body is required')
    return db.posts.update(c.resource.id, c.body)
  },
})
