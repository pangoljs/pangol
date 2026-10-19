import { route, t } from 'pangol'
import { posts } from '../../db.js'
export default route({
  auth: { permission: 'posts:write' }, params: t.object({ id: t.uuid() }), response: t.empty(),
  load: c => posts.get(c.params.id), owner: (c, post) => post.ownerId === c.user.id,
  handler: async c => await posts.remove(c.resource.id, c.user.id) ? c.noContent() : c.fail(404, 'not found'),
})
