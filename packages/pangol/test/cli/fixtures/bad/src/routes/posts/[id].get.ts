import { route, t } from '../../../../../../../src/index.js'

const posts = new Map([['p1', { id: 'p1', authorId: 'ada', title: 'x' }]])
// C7: loads and checks one record, then reads another one from c.params
export default route({
  auth: 'user',
  params: t.object({ id: t.id() }),
  load: (c) => posts.get(c.params.id),
  owner: (c, post) => post.authorId === c.user.id,
  response: t.object({ title: t.string() }),
  handler: (ctx) => posts.get(ctx.params.id) ?? { title: '' },
})
