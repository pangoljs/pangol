// shared ownership helpers
export const isAuthorOrModerator = (c, post) => post.authorId === c.user.id || c.user.permissions.includes('posts:moderate')
