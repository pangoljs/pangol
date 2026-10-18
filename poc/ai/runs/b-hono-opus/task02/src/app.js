import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { db } from './db.js'

const app = new Hono()

app.use('*', secureHeaders())

// ---------- shared helpers ----------

const BEARER_RE = /^Bearer[ \t]+([A-Za-z0-9._~+/=-]+)[ \t]*$/i

// Returns the signed-in user for the request, or undefined.
const currentUser = (c) => {
  const match = BEARER_RE.exec(c.req.header('authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

const unauthorized = (c) => {
  c.header('WWW-Authenticate', 'Bearer')
  return c.json({ error: 'Authentication required' }, 401)
}

// Middleware: rejects the request with 401 unless a valid session token is supplied.
const requireAuth = async (c, next) => {
  const user = currentUser(c)
  if (!user) return unauthorized(c)
  c.set('user', user)
  await next()
}

const hasPermission = (user, permission) =>
  Array.isArray(user?.permissions) && user.permissions.includes(permission)

// Only these fields are ever sent to clients (never passwordHash).
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const body = { error: err.message || 'Request failed' }
    if (err.details) body.details = err.details
    return c.json(body, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

// ---------- routes ----------

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 100

// List users. Requires the users:read permission.
// ?limit=N  (integer 1..100, default 50)
app.get('/users', requireAuth, (c) => {
  if (!hasPermission(c.get('user'), 'users:read')) return c.json({ error: 'Forbidden' }, 403)

  let limit = DEFAULT_LIMIT
  const raw = c.req.query('limit')
  if (raw !== undefined) {
    if (!/^\d{1,4}$/.test(raw) || Number(raw) < 1 || Number(raw) > MAX_LIMIT) {
      return c.json({ error: `limit must be an integer between 1 and ${MAX_LIMIT}` }, 400)
    }
    limit = Number(raw)
  }

  const users = db.users
    .all()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .slice(0, limit)
    .map(publicUser)
  c.header('Cache-Control', 'private, no-store')
  return c.json(users)
})

export default app
