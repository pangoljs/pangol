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

app.get('/posts', (c) => {
  // Anonymous callers are allowed, but a sent Authorization header must hold a valid token.
  let caller
  if (c.req.header('Authorization') !== undefined) {
    caller = userFrom(c)
    if (!caller) return c.json({ error: 'Invalid token' }, 401)
  }

  const wantedAuthor = c.req.query('authorId')
  const posts = db.posts
    .all()
    .filter((p) => (p.published || (caller && p.authorId === caller.id)))
    .filter((p) => wantedAuthor === undefined || p.authorId === wantedAuthor)
    .map(({ id, title, authorId }) => ({ id, title, authorId }))
  return c.json(posts)
})

export default app
