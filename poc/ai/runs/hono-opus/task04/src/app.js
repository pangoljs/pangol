import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

const err = (c, status, error) => c.json({ error }, status)

// Returns { user } on success, or { status } (401) when header missing or token invalid.
const authenticate = (c) => {
  const h = c.req.header('Authorization')
  if (h === undefined) return { status: 401, missing: true }
  const m = /^Bearer[ ]+(\S+)\s*$/i.exec(h.trim())
  if (!m) return { status: 401 }
  const user = db.sessions.userForToken(m[1])
  if (!user) return { status: 401 }
  return { user }
}

const requireUser = (c) => {
  const a = authenticate(c)
  if (!a.user) return { res: err(c, 401, 'Unauthorized') }
  return { user: a.user }
}

const readBody = async (c) => {
  try {
    const b = await c.req.json()
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return undefined
    return b
  } catch {
    return undefined
  }
}

const isEmail = (s) =>
  typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s)

app.notFound((c) => err(c, 404, 'Not found'))
app.onError((e, c) => err(c, 500, 'Internal server error'))

app.post('/users', async (c) => {
  const { user, res } = requireUser(c)
  if (res) return res
  if (!user.permissions?.includes('users:write')) return err(c, 403, 'Forbidden')
  const body = await readBody(c)
  if (!body) return err(c, 400, 'Invalid JSON body')
  const { name, email } = body
  if (typeof name !== 'string' || name.trim().length < 1 || name.length > 100)
    return err(c, 400, 'name must be a string of 1-100 characters')
  if (!isEmail(email)) return err(c, 400, 'email must be a valid email address')
  if (db.users.findByEmail(email)) return err(c, 409, 'A user with that email already exists')
  const u = db.users.create({ name, email, role: 'member', permissions: [] })
  return c.json({ id: u.id, name: u.name, email: u.email, role: u.role }, 201)
})

export default app
