import { route, t } from '../../../../../../../src/index.js'

// C14: GET /dup is also dup.get.ts
export default route({ auth: 'public', response: t.string(), handler: () => 'b' })
