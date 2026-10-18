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
app.delete('/posts/:id', (c) => {
  const u = authUser(c)
  if (!u) return err(c, 401, 'Unauthorized')
  const p = db.posts.get(c.req.param('id'))
  if (!p) return err(c, 404, 'Post not found')
  if (!canEdit(u, p)) return err(c, 403, 'Forbidden')
  db.posts.delete(p.id)
  return c.body(null, 204)
})

export default app
