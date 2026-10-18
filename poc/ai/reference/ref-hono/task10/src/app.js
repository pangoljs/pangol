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

const WINDOW = 15 * 60 * 1000
const failures = new Map()
app.post('/auth/login', zValidator('json', z.object({ email: z.email(), password: z.string().min(1).max(200) }), invalid), (c) => {
  const { email, password } = c.req.valid('json')
  const key = email.toLowerCase()
  const now = Date.now()
  const recent = (failures.get(key) ?? []).filter((t) => now - t < WINDOW)
  failures.set(key, recent)
  if (recent.length >= 5) return c.json({ error: 'too many attempts' }, 429)
  const user = db.users.findByEmail(key)
  if (!user || !db.verifyPassword(user, password)) { recent.push(now); return c.json({ error: 'invalid email or password' }, 401) }
  return c.json({ token: db.sessions.create(user.id) })
})
export default app
