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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

app.post('/users', requireAuth, requirePermission('users:write'), async (c) => {
  if (c.get('user').role !== 'admin') return fail(c, 403, 'Forbidden')
  const body = await readJson(c)
  if (!body) return fail(c, 400, 'Body must be a JSON object')
  const name = typeof body.name === 'string' ? body.name.trim() : ''
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!name || name.length > 200) return fail(c, 400, 'name is required (max 200 characters)')
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return fail(c, 400, 'A valid email is required')
  if (db.users.findByEmail(email)) return fail(c, 409, 'Email already in use')
  // Only name and email come from the caller; role and permissions are fixed.
  const user = db.users.create({ name, email, role: 'member', permissions: [] })
  return c.json(publicUser(user), 201)
})

export default app
