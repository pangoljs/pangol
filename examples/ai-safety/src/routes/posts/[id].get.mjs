import { route, t } from 'pangol'
import { Post, posts } from '../../models.mjs'

export default route({
  auth: 'user',
  params: t.object({ id: t.id() }),
  load: (c) => posts.get(c.params.id),
  owner: (c, post) => post.ownerId === c.user.id,
  response: Post.public(),
  handler: (c) => c.resource,
})
