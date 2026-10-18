import { Hono } from 'hono'
import { z } from 'zod'
import { db } from './db.js'

const app = new Hono()

// Public user fields. The password hash never leaves the server.
const publicUser = ({ passwordHash, ...user }) => user

// The user behind the Bearer token, or undefined if the token is missing or unknown.
function currentUser(c) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

// Unknown fields (such as role or permissions) are dropped, so clients cannot grant themselves access.
const newUser = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
})

async function readJson(c) {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

app.post('/users', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'Not signed in' }, 401)
  if (!user.permissions.includes('users:write')) return c.json({ error: 'Forbidden' }, 403)

  const parsed = newUser.safeParse(await readJson(c))
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)

  if (db.users.findByEmail(parsed.data.email)) {
    return c.json({ error: 'A user with this email already exists' }, 409)
  }

  const created = db.users.create({
    name: parsed.data.name,
    email: parsed.data.email,
    role: 'member',
    permissions: [],
  })
  return c.json(publicUser(created), 201)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
