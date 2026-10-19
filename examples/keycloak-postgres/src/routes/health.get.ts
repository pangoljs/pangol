import { route, t } from 'pangol'
export default route({ auth: 'public', response: t.object({ ok: t.bool() }), handler: () => ({ ok: true }) })
