import { route, t } from 'pangol'

// Echo the validated draft so tests can see exactly what the handler received.
export default route({
  auth: 'user',
  body: t.object({ title: t.string({ min: 1, max: 100 }) }),
  response: t.object({ title: t.string(), ownerId: t.id() }),
  handler: (c) => ({ ...c.body, ownerId: c.user.id }),
})
