import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { post } from './_schemas.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  body: t.object({
    title: t.string({ min: 1, max: 200 }).optional(),
    body: t.string({ max: 10000 }).optional(),
  }),
  response: post,
  load: (c) => db.posts.get(c.params.id),
  // Authors and moderators may edit; anyone else gets 403 (checked in the handler).
  owner: 'none',
  handler: (c) => {
    const current = c.resource
    const isModerator = c.user.permissions.includes('posts:moderate')
    if (current.authorId !== c.user.id && !isModerator) return c.fail(403, 'forbidden')
    if (c.body.title === undefined && c.body.body === undefined) {
      return c.fail(400, 'nothing to update: send title and/or body')
    }
    return db.posts.update(current.id, c.body)
  },
})
