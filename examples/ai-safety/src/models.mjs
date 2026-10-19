import { t } from 'pangol'

export const Post = t.model({
  id: t.id(),
  title: t.string({ min: 1, max: 100 }),
  ownerId: t.id(),
  internalNote: t.string().private(),
})
export const posts = new Map([
  ['p1', { id: 'p1', title: 'Hello', ownerId: 'alice', internalNote: 'staff-only' }],
])
