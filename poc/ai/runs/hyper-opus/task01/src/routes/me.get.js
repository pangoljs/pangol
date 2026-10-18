import { route, t } from 'hyperflat'

export default route({
  auth: 'user',
  response: t.object({ id: t.string(), name: t.string(), email: t.string() }),
  handler: (c) => ({ id: c.user.id, name: c.user.name, email: c.user.email }),
})
