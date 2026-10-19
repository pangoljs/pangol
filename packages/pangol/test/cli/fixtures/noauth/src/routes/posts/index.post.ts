import { route, t } from '../../../../../../../src/index.js'

// C14: not public, and there is no src/auth.ts
export default route({ auth: 'user', body: t.object({ title: t.string() }), response: t.empty(), handler: (c) => c.noContent() })
