import { route, t } from '../../../../../../../src/index.js'
import { Post } from '../../models.js'
import { loadPost } from './_owned.js'

export default route({
  auth: 'user',
  params: t.object({ id: t.id() }),
  body: Post.pick('title').partial(),
  load: (c) => loadPost(c.params.id),
  owner: (c, post) => post.authorId === c.user.id,
  response: Post.public(),
  handler: ({ resource, body }) => ({ ...resource, title: body.title ?? resource.title }),
})
