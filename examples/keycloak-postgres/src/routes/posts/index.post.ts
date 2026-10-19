import { route } from 'pangol'
import { Post } from '../../models.js'
import { posts } from '../../db.js'
export default route({
  auth: { permission: 'posts:write' }, body: Post.pick('title'), response: Post.public(),
  handler: async c => c.created(await posts.create(c.user.id, c.body.title)),
})
