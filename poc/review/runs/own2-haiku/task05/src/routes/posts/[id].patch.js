import { route, t } from 'hyperflat'
import { db } from '../../db.js'

// Authors edit their own posts; moderators (posts:moderate) edit any post.
// Anyone else gets 404 so the existence of other people's posts is not revealed.
export default route({
  auth: 'user',
  params: t.object({ id: t.string() }),
  load: (c) => db.posts.get(c.params.id),
  owner: (c, post) => post.authorId === c.user.id || c.user.permissions.includes('posts:moderate'),
  body: t.object({
    title: t.string({ min: 1, max: 200 }).optional(),
    body: t.string({ min: 1, max: 10000 }).optional(),
  }),
  response: t.object({
    id: t.string(),
    authorId: t.string(),
    title: t.string(),
    body: t.string(),
    published: t.bool(),
  }),
  handler: (c) => {
    if (c.body.title === undefined && c.body.body === undefined) {
      return c.fail(400, 'provide title and/or body')
    }
    return db.posts.update(c.resource.id, c.body)
  },
})
