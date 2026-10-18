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

app.get('/posts', (c) => {
  let u
  if (c.req.header('authorization') !== undefined) {
    u = authUser(c)
    if (!u) return err(c, 401, 'Unauthorized')
  }
  const authorId = c.req.query('authorId')
  const list = db.posts
    .all()
    .filter((p) => p.published || (u && p.authorId === u.id))
    .filter((p) => authorId === undefined || p.authorId === authorId)
    .map((p) => ({ id: p.id, title: p.title, authorId: p.authorId }))
  return c.json(list)
})

export default app
