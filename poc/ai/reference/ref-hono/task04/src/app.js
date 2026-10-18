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

app.post('/users', requireUser({ permission: 'users:write' }),
  zValidator('json', z.object({ name: z.string().min(1).max(100), email: z.email() }), invalid),
  (c) => {
    const { name, email } = c.req.valid('json')
    if (db.users.findByEmail(email)) return c.json({ error: 'email already in use' }, 409)
    const u = db.users.create({ name, email, role: 'member', permissions: [] })
    return c.json({ id: u.id, name: u.name, email: u.email, role: u.role }, 201)
  })
export default app
