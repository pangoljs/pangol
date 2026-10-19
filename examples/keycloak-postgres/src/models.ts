import { t } from 'pangol'
export const Post = t.model({
  id: t.uuid(), title: t.string({ min: 1, max: 200 }), ownerId: t.uuid(), internalNote: t.string().private(),
})
