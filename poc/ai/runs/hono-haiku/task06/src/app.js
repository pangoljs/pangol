import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => c.json({ error: 'Internal server error' }, 500))

// The user for the Authorization: Bearer token, or undefined.
const userFrom = (c) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

const signedIn = async (c, next) => {
  if (!userFrom(c)) return c.json({ error: 'Sign in required' }, 401)
  await next()
}

app.delete('/posts/:id', signedIn, (c) => {
  const user = userFrom(c)
  const post = db.posts.get(c.req.param('id'))
  if (!post) return c.json({ error: 'Post not found' }, 404)
  if (post.authorId !== user.id && !user.permissions.includes('posts:moderate')) {
    return c.json({ error: 'Forbidden' }, 403)
  }
  db.posts.delete(post.id)
  return c.body(null, 204)
})

export default app
