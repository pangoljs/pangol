import { route, t } from 'hyperflat'

export default route({
  auth: 'public',
  response: t.object({
    status: t.enum(['ok']),
    uptime: t.number({ min: 0 }),
  }),
  handler: () => ({ status: 'ok', uptime: Math.floor(process.uptime()) }),
})
