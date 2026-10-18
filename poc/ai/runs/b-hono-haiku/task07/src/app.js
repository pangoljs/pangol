import { Hono } from 'hono'
import { z } from 'zod'
import { db } from './db.js'

const app = new Hono()

// The user behind the Bearer token, or undefined if the token is unknown.
function currentUser(c) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

const listQuery = z.object({
  authorId: z.string().min(1).optional(),
})

app.get('/posts', (c) => {
  // Anonymous callers may list published posts. A token that is sent but not valid is an error.
  let viewer
  if (c.req.header('Authorization') !== undefined) {
    viewer = currentUser(c)
    if (!viewer) return c.json({ error: 'Not signed in' }, 401)
  }

  const query = listQuery.safeParse(c.req.query())
  if (!query.success) return c.json({ error: 'Invalid query', details: query.error.issues }, 400)
  const { authorId } = query.data

  const posts = db.posts
    .all()
    .filter((p) => p.published || (viewer !== undefined && p.authorId === viewer.id))
    .filter((p) => authorId === undefined || p.authorId === authorId)

  return c.json({ posts })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
