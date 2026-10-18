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

app.get('/users', permitted('users:read'), (c) => {
  const raw = c.req.query('limit')
  let limit = 20
  if (raw !== undefined) {
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
      return c.json({ error: 'limit must be a whole number from 1 to 100' }, 400)
    }
    limit = Number(raw)
  }
  const users = db.users.all().slice(0, limit).map(({ id, name, email }) => ({ id, name, email }))
  return c.json(users)
})

export default app
