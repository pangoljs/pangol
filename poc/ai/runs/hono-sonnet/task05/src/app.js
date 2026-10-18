import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

const err = (c, status, message) => c.json({ error: message }, status)
const authUser = (c) => {
  const h = c.req.header('authorization')
  if (!h) return undefined
  const m = /^Bearer\s+(\S+)\s*$/i.exec(h)
  if (!m) return undefined
  return db.sessions.userForToken(m[1])
}
const readBody = async (c) => {
  try {
    const b = await c.req.json()
    return b && typeof b === 'object' && !Array.isArray(b) ? b : undefined
  } catch {
    return undefined
  }
}
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const isEmail = (s) => typeof s === 'string' && s.length <= 254 && EMAIL.test(s)

const canEdit = (u, p) => p.authorId === u.id || u.permissions.includes('posts:moderate')
app.patch('/posts/:id', async (c) => {
  const u = authUser(c)
  if (!u) return err(c, 401, 'Unauthorized')
  const p = db.posts.get(c.req.param('id'))
  if (!p) return err(c, 404, 'Post not found')
  if (!canEdit(u, p)) return err(c, 403, 'Forbidden')
  const b = await readBody(c)
  if (!b) return err(c, 400, 'Invalid body')
  const patch = {}
  if (b.title !== undefined) {
    if (typeof b.title !== 'string' || b.title.length < 1 || b.title.length > 200) return err(c, 400, 'Invalid title')
    patch.title = b.title
  }
  if (b.body !== undefined) {
    if (typeof b.body !== 'string' || b.body.length > 5000) return err(c, 400, 'Invalid body')
    patch.body = b.body
  }
  if (Object.keys(patch).length === 0) return err(c, 400, 'Provide title and/or body')
  const x = db.posts.update(p.id, patch)
  return c.json({ id: x.id, title: x.title, body: x.body, authorId: x.authorId })
})

export default app
