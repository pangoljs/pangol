import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

const fail = (c, status, error) => c.json({ error }, status)

const publicUser = ({ passwordHash, ...rest }) => rest

// Returns the signed-in user, null when no credentials were sent, or undefined when they are invalid.
function authenticate(c) {
  const header = c.req.header('authorization')
  if (!header) return null
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!m) return undefined
  return db.sessions.userForToken(m[1])
}

const requireAuth = async (c, next) => {
  const user = authenticate(c)
  if (!user) return fail(c, 401, 'Authentication required')
  c.set('user', user)
  await next()
}

const requirePermission = (permission) => async (c, next) => {
  if (!c.get('user').permissions.includes(permission)) return fail(c, 403, 'Forbidden')
  await next()
}

async function readJson(c) {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : undefined
  } catch {
    return undefined
  }
}

app.notFound((c) => fail(c, 404, 'Not found'))
app.onError((err, c) => {
  console.error(err)
  return fail(c, 500, 'Internal server error')
})

app.get('/posts', (c) => {
  // Authentication is optional: anonymous callers see published posts only.
  const user = authenticate(c)
  if (user === undefined) return fail(c, 401, 'Invalid token')
  const authorId = c.req.query('authorId') ?? c.req.query('author')
  const posts = db.posts
    .all()
    .filter((p) => p.published || (user && p.authorId === user.id))
    .filter((p) => authorId === undefined || p.authorId === authorId)
    .sort((a, b) => Number(a.id) - Number(b.id))
  return c.json({ posts })
})

export default app
