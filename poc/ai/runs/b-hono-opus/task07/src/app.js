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

// List posts. Anonymous callers see published posts; a signed-in user also sees their own drafts.
// Drafts are never shown to anyone but their author.
// ?author=<userId>  (alias: ?authorId=) filters by author.
app.get('/posts', (c) => {
  let user
  if (c.req.header('authorization') !== undefined) {
    user = currentUser(c)
    if (!user) return unauthorized(c) // a bad token is an error, not a silent downgrade
  }

  const author = c.req.query('author') ?? c.req.query('authorId')
  if (author !== undefined && !/^\d{1,20}$/.test(author)) {
    return c.json({ error: 'author must be a user id' }, 400)
  }

  const posts = db.posts
    .all()
    .filter((p) => p.published === true || (user !== undefined && p.authorId === user.id))
    .filter((p) => author === undefined || p.authorId === author)
    .sort((a, b) => Number(a.id) - Number(b.id))

  c.header('Cache-Control', user ? 'private, no-store' : 'no-cache')
  c.header('Vary', 'Authorization')
  return c.json(posts)
})

export default app
