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

const permitted = (permission) => async (c, next) => {
  const user = userFrom(c)
  if (!user) return c.json({ error: 'Sign in required' }, 401)
  if (!user.permissions.includes(permission)) return c.json({ error: 'Forbidden' }, 403)
  await next()
}

app.get('/users/:id', permitted('users:read'), (c) => {
  const user = db.users.get(c.req.param('id'))
  if (!user) return c.json({ error: 'User not found' }, 404)
  const { id, name, email, role } = user
  return c.json({ id, name, email, role })
})

export default app
