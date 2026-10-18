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

app.patch('/posts/:id', async (c) => {
  const { user, res } = requireUser(c)
  if (res) return res
  const body = await readBody(c)
  if (!body) return err(c, 400, 'Invalid JSON body')
  const { title, body: text } = body
  const hasTitle = title !== undefined
  const hasBody = text !== undefined
  if (!hasTitle && !hasBody) return err(c, 400, 'Provide title and/or body')
  if (hasTitle && (typeof title !== 'string' || title.length < 1 || title.length > 200))
    return err(c, 400, 'title must be a string of 1-200 characters')
  if (hasBody && (typeof text !== 'string' || text.length > 5000))
    return err(c, 400, 'body must be a string of up to 5000 characters')
  const post = db.posts.get(c.req.param('id'))
  if (!post) return err(c, 404, 'Post not found')
  if (post.authorId !== user.id && !user.permissions?.includes('posts:moderate'))
    return err(c, 403, 'Forbidden')
  const patch = {}
  if (hasTitle) patch.title = title
  if (hasBody) patch.body = text
  const p = db.posts.update(post.id, patch)
  return c.json({ id: p.id, title: p.title, body: p.body, authorId: p.authorId })
})

export default app
