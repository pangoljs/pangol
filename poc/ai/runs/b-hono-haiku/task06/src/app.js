import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

// The user behind the Bearer token, or undefined if the token is missing or unknown.
function currentUser(c) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

app.delete('/posts/:id', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'Not signed in' }, 401)

  const post = db.posts.get(c.req.param('id'))
  const isAuthor = post?.authorId === user.id
  const isModerator = user.permissions.includes('posts:moderate')

  // Same rules as editing: drafts are hidden from everyone except the author and moderators.
  if (!post || (!post.published && !isAuthor && !isModerator)) {
    return c.json({ error: 'Post not found' }, 404)
  }
  if (!isAuthor && !isModerator) return c.json({ error: 'Forbidden' }, 403)

  db.posts.delete(post.id)
  return c.body(null, 204)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
