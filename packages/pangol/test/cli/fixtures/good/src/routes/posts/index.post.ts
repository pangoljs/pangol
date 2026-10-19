import { route, t } from '../../../../../../../src/index.js'
import { Post } from '../../models.js'

export default route({
  auth: 'user',
  body: Post.pick('title', 'price', 'notes'),
  response: Post.public(),
  rateLimit: '10/min',
  description: 'Create a post',
  handler: (c) => (c.body.title === 'taken'
    ? c.fail(409, 'title taken')
    : c.created({ id: 'p2', authorId: c.user.id, title: c.body.title, price: c.body.price })),
})
