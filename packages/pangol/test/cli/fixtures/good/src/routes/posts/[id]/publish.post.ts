import { route, t } from '../../../../../../../../src/index.js'

export default route({
  auth: { permission: 'admin' },
  params: t.object({ id: t.id() }),
  owner: 'none',
  response: t.empty(),
  handler: (c) => c.noContent(),
})
