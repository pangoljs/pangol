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

app.delete('/posts/:id', requireUser(), (c) => {
  const user = c.get('user')
  const post = db.posts.get(c.req.param('id'))
  if (!post) return c.json({ error: 'post not found' }, 404)
  if (post.authorId !== user.id && !user.permissions.includes('posts:moderate')) return c.json({ error: 'forbidden' }, 403)
  db.posts.delete(post.id)
  return c.body(null, 204)
})
export default app
