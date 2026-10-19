import { t } from '../../../../../src/index.js'

export const Post = t.model({ id: t.id(), authorId: t.id(), title: t.string({ max: 200 }), price: t.money(), notes: t.string().private() })
export const posts = new Map([['p1', { id: 'p1', authorId: 'ada', title: 'Hello', price: 1250n, notes: 'secret' }]])
