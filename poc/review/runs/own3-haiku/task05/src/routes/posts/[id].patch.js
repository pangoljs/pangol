import { route, t } from 'hyperflat'
import { db } from '../../db.js'
import { post } from './_schemas.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.posts.get(c.params.id),
  owner: (c, item) => item.authorId === c.user.id || c.user.permissions.includes('posts:moderate'),
  body: t.object({
    title: t.string({ min: 1, max: 200 }).optional(),
    body: t.string({ min: 1, max: 10000 }).optional(),
  }),
  response: post,
  handler: (c) => {
    const patch = {}
    if (c.body.title !== undefined) patch.title = c.body.title
    if (c.body.body !== undefined) patch.body = c.body.body
    if (Object.keys(patch).length === 0) return c.fail(400, 'nothing to update: send title and/or body')
    return db.posts.update(c.resource.id, patch)
  },
})
