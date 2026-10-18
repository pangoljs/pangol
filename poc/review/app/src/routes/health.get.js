import { route, t } from 'hyperflat'
export default route({ auth: 'public', response: t.object({ ok: t.bool() }), handler: () => ({ ok: true }) })
