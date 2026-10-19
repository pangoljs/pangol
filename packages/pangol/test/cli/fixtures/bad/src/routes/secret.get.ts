import { route, t } from '../../../../../../src/index.js'

// C10: a private field in the response
const User = t.model({ id: t.id(), passwordHash: t.string().private() })
export default route({ auth: 'user', response: User as never, handler: () => ({ id: 'u', passwordHash: 'h' }) as never })
