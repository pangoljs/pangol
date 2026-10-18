import { t } from 'hyperflat'

export const postSchema = t.object({
  id: t.string(),
  authorId: t.string(),
  title: t.string(),
  body: t.string(),
  published: t.bool(),
})

// Authors may manage their own posts; moderators may manage any post.
export const canManage = (user, post) =>
  post.authorId === user.id || user.permissions.includes('posts:moderate')
