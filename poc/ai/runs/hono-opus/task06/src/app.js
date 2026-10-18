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

app.delete('/posts/:id', (c) => {
  const { user, res } = requireUser(c)
  if (res) return res
  const post = db.posts.get(c.req.param('id'))
  if (!post) return err(c, 404, 'Post not found')
  if (post.authorId !== user.id && !user.permissions?.includes('posts:moderate'))
    return err(c, 403, 'Forbidden')
  db.posts.delete(post.id)
  return c.body(null, 204)
})

export default app
