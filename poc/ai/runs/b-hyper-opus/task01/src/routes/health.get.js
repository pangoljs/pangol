import { route, t } from 'hyperflat'

export default route({
  auth: 'public',
  response: t.object({ status: t.enum(['ok']) }),
  handler: () => ({ status: 'ok' }),
})
