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

// Only title and body are editable; anything else (authorId, published, id, ...) is ignored.
const editPostSchema = z
  .object({
    title: z.string().trim().min(1, 'title cannot be empty').max(200).optional(),
    body: z.string().max(20000).optional(),
  })
  .refine((v) => v.title !== undefined || v.body !== undefined, {
    message: 'Provide title and/or body',
  })

const canEditPost = (user, post) => post.authorId === user.id || hasPermission(user, 'posts:moderate')

// Edit a post: its author, or a moderator (posts:moderate).
app.patch('/posts/:id', requireAuth, async (c) => {
  const user = c.get('user')
  const post = db.posts.get(c.req.param('id'))
  if (!post) return c.json({ error: 'Post not found' }, 404)
  // Other users' drafts are not visible to them, so do not reveal they exist.
  if (!canEditPost(user, post)) {
    return post.published ? c.json({ error: 'Forbidden' }, 403) : c.json({ error: 'Post not found' }, 404)
  }

  const input = await readBody(c, editPostSchema)
  const patch = {}
  if (input.title !== undefined) patch.title = input.title
  if (input.body !== undefined) patch.body = input.body

  const updated = db.posts.update(post.id, patch)
  if (!updated) return c.json({ error: 'Post not found' }, 404)
  return c.json(updated)
})

export default app
