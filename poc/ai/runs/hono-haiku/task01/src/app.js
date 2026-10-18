import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => c.json({ error: 'Internal server error' }, 500))

// The user for the Authorization: Bearer token, or undefined.
const userFrom = (c) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

const signedIn = async (c, next) => {
  if (!userFrom(c)) return c.json({ error: 'Sign in required' }, 401)
  await next()
}

app.get('/health', (c) => c.json({ ok: true }))

app.get('/me', signedIn, (c) => {
  const { id, name, email } = userFrom(c)
  return c.json({ id, name, email })
})

export default app
