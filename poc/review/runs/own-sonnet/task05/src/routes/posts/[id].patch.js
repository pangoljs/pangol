import { route, t } from 'hyperflat'
import { db } from '../../db.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  body: t.object({
    title: t.string({ min: 1, max: 200 }).optional(),
    body: t.string({ min: 1, max: 20000 }).optional(),
  }),
  load: (c) => db.posts.get(c.params.id),
  // authors and moderators only; everyone else gets 404 so ids cannot be probed
  owner: (c, post) => post.authorId === c.user.id || c.user.permissions.includes('posts:moderate'),
  response: t.object({
    id: t.string(),
    authorId: t.string(),
    title: t.string(),
    body: t.string(),
    published: t.bool(),
  }),
  handler: (c) => {
    const patch = {}
    if (c.body.title !== undefined) patch.title = c.body.title
    if (c.body.body !== undefined) patch.body = c.body.body
    if (Object.keys(patch).length === 0) return c.fail(400, 'nothing to update')
    return db.posts.update(c.resource.id, patch)
  },
})
