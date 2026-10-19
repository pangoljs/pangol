import { route, t } from '../../../../../../../src/index.js'

// C8: owner 'none', but the handler makes its own 403 decision
export default route({
  auth: 'user',
  params: t.object({ id: t.id() }),
  owner: 'none',
  response: t.string(),
  handler: ({ user, fail }) => (user.id === 'ada' ? 'ok' : fail(403, 'not yours')),
})
