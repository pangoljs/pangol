import { route, t } from 'hyperflat'

export default route({
  auth: 'user',
  response: t.object({
    id: t.string(),
    name: t.string(),
    email: t.email(),
    role: t.string(),
    permissions: t.array(t.string()),
  }),
  handler: (c) => c.user,
})
