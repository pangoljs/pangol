import { route, t } from 'pangol'
import { Post } from '../../models.js'
import { posts } from '../../db.js'
export default route({
  auth: 'user', params: t.object({ id: t.uuid() }), response: Post.public(),
  load: c => posts.get(c.params.id), owner: (c, post) => post.ownerId === c.user.id,
  handler: c => c.resource,
})
