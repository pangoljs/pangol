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

app.get('/users/:id', requireUser({ permission: 'users:read' }), (c) => {
  const u = db.users.get(c.req.param('id'))
  if (!u) return c.json({ error: 'user not found' }, 404)
  return c.json({ id: u.id, name: u.name, email: u.email, role: u.role })
})
export default app
