import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { db } from './db.js'
import { z } from 'zod'

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

const MAX_BODY_BYTES = 16 * 1024

// Parses the JSON request body (size-limited) and validates it against a zod schema.
// Throws a 400 / 413 HTTPException on bad input.
const readBody = async (c, schema) => {
  const declared = Number(c.req.header('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HTTPException(413, { message: 'Request body too large' })
  }
  const text = await c.req.text()
  if (text.length > MAX_BODY_BYTES) throw new HTTPException(413, { message: 'Request body too large' })
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new HTTPException(400, { message: 'Request body must be valid JSON' })
  }
  const result = schema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message }))
    throw Object.assign(new HTTPException(400, { message: 'Invalid input' }), { details })
  }
  return result.data
}

// ---------- routes ----------

// Unknown fields (role, permissions, passwordHash, ...) are stripped: callers cannot choose them.
const createUserSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(100),
  email: z.string().trim().toLowerCase().pipe(z.email('email must be a valid email address').max(254)),
})

// Create a user. Only admins holding users:write may do this. New users are always plain members.
app.post('/users', requireAuth, async (c) => {
  const actor = c.get('user')
  if (actor.role !== 'admin' || !hasPermission(actor, 'users:write')) {
    return c.json({ error: 'Forbidden' }, 403)
  }

  const { name, email } = await readBody(c, createUserSchema)
  if (db.users.findByEmail(email)) {
    return c.json({ error: 'A user with this email already exists' }, 409)
  }

  const user = db.users.create({ name, email, role: 'member', permissions: [], passwordHash: null })
  c.header('Location', `/users/${user.id}`)
  return c.json(publicUser(user), 201)
})

export default app
