import { route, t } from 'pangol'
export default route({ auth: 'user', response: t.object({ id: t.uuid(), permissions: t.array(t.string()) }), handler: c => ({ id: c.user.id, permissions: [...c.user.permissions] }) })
