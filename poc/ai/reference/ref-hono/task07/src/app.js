import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { db } from './db.js'

const app = new Hono()
const invalid = (r, c) => { if (!r.success) return c.json({ error: 'invalid input' }, 400) }
const requireUser = (opts = {}) => createMiddleware(async (c, next) => {
  const h = c.req.header('authorization')
  if (!h) { if (opts.optional) { c.set('user', null); return next() } return c.json({ error: 'unauthorized' }, 401) }
  if (!h.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401)
  const user = db.sessions.userForToken(h.slice(7))
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (opts.permission && !user.permissions.includes(opts.permission)) return c.json({ error: 'forbidden' }, 403)
  c.set('user', user)
  await next()
})

app.get('/posts', requireUser({ optional: true }), zValidator('query', z.object({ authorId: z.string().optional() }), invalid), (c) => {
  const user = c.get('user')
  const { authorId } = c.req.valid('query')
  return c.json(db.posts.all()
    .filter((p) => p.published || (user && p.authorId === user.id))
    .filter((p) => authorId === undefined || p.authorId === authorId)
    .map((p) => ({ id: p.id, title: p.title, authorId: p.authorId })))
})
export default app
