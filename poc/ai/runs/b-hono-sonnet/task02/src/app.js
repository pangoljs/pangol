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

app.get('/users', requireAuth, requirePermission('users:read'), (c) => {
  const raw = c.req.query('limit')
  let limit = 50
  if (raw !== undefined) {
    if (!/^\d+$/.test(raw) || Number(raw) < 1 || Number(raw) > 100) {
      return fail(c, 400, 'limit must be an integer between 1 and 100')
    }
    limit = Number(raw)
  }
  const users = db.users
    .all()
    .sort((a, b) => Number(a.id) - Number(b.id))
    .slice(0, limit)
    .map(publicUser)
  return c.json({ users })
})

export default app
