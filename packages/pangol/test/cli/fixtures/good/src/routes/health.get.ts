import { route, t } from '../../../../../../src/index.js'

export default route({ auth: 'public', response: t.object({ ok: t.bool() }), handler: () => ({ ok: true }) })
