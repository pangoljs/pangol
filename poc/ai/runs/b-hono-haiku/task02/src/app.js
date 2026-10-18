import { Hono } from 'hono'
import { z } from 'zod'
import { db } from './db.js'

const app = new Hono()

// Public user fields. The password hash never leaves the server.
const publicUser = ({ passwordHash, ...user }) => user

// The user behind the Bearer token, or undefined if the token is missing or unknown.
function currentUser(c) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

const listQuery = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

app.get('/users', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'Not signed in' }, 401)
  if (!user.permissions.includes('users:read')) return c.json({ error: 'Forbidden' }, 403)

  const query = listQuery.safeParse(c.req.query())
  if (!query.success) return c.json({ error: 'Invalid query', details: query.error.issues }, 400)

  const all = db.users.all()
  return c.json({
    users: all.slice(0, query.data.limit).map(publicUser),
    total: all.length,
  })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
