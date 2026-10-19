import { route, t } from '../../../../../../src/index.js'

export default route({ auth: 'public', response: t.string(), handler: () => 'a' })
