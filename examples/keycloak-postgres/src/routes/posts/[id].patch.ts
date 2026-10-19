import { route, t } from 'pangol'
import { Post } from '../../models.js'
import { posts } from '../../db.js'
export default route({
  auth: { permission: 'posts:write' }, params: t.object({ id: t.uuid() }), body: Post.pick('title'), response: Post.public(),
  load: c => posts.get(c.params.id), owner: (c, post) => post.ownerId === c.user.id,
  handler: async c => await posts.update(c.resource.id, c.user.id, c.body.title) ?? c.fail(404, 'not found'),
})
