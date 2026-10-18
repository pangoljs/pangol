import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

// Public user fields. The password hash never leaves the server.
const publicUser = ({ passwordHash, ...user }) => user

// The user behind the Bearer token, or undefined if the token is missing or unknown.
function currentUser(c) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

app.get('/health', (c) => c.json({ status: 'ok', uptime: Math.floor(process.uptime()) }))

app.get('/me', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'Not signed in' }, 401)
  return c.json(publicUser(user))
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
