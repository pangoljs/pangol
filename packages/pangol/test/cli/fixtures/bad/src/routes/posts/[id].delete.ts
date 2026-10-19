import { route, t } from '../../../../../../../src/index.js'

// C6: acts on a record without an owner rule
export default route({ auth: 'user', params: t.object({ id: t.id() }), response: t.empty(), handler: (c) => c.noContent() })
