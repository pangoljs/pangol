import { route, t } from '../../../../../../src/index.js'

// C13: t.empty() response, but the handler never calls c.noContent()
export default route({ auth: 'user', response: t.empty(), handler: () => undefined as never })
