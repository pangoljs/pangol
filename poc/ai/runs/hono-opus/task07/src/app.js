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

app.get('/posts', (c) => {
  const a = authenticate(c)
  if (!a.user && !a.missing) return err(c, 401, 'Unauthorized')
  const me = a.user
  const authorId = c.req.query('authorId')
  const list = db.posts
    .all()
    .filter((p) => p.published === true || (me && p.authorId === me.id))
    .filter((p) => authorId === undefined || p.authorId === authorId)
    .map((p) => ({ id: p.id, title: p.title, authorId: p.authorId }))
  return c.json(list)
})

export default app
