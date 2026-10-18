import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => c.json({ error: 'Internal server error' }, 500))

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// The user for the Authorization: Bearer token, or undefined.
const userFrom = (c) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

// The JSON body if it is an object, otherwise undefined.
const readBody = async (c) => {
  try {
    const data = await c.req.json()
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : undefined
  } catch {
    return undefined
  }
}

const permitted = (permission) => async (c, next) => {
  const user = userFrom(c)
  if (!user) return c.json({ error: 'Sign in required' }, 401)
  if (!user.permissions.includes(permission)) return c.json({ error: 'Forbidden' }, 403)
  await next()
}

app.post('/users', permitted('users:write'), async (c) => {
  const input = await readBody(c)
  if (!input) return c.json({ error: 'Request body must be a JSON object' }, 400)

  const { name, email } = input
  if (typeof name !== 'string' || [...name].length < 1 || [...name].length > 100) {
    return c.json({ error: 'name must be a string of 1 to 100 characters' }, 400)
  }
  if (typeof email !== 'string' || !EMAIL.test(email)) {
    return c.json({ error: 'email must be a valid email address' }, 400)
  }
  if (db.users.findByEmail(email)) {
    return c.json({ error: 'A user with this email already exists' }, 409)
  }

  const user = db.users.create({ name, email, role: 'member', permissions: [] })
  return c.json({ id: user.id, name: user.name, email: user.email, role: user.role }, 201)
})

export default app
