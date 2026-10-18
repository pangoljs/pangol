// Same API in idiomatic Hono: middleware for auth, zValidator for input, Zod parse to filter the response.
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { zValidator } from '@hono/zod-validator'
import { z } from 'zod'
import { users, sessions } from '../shared/data.mjs'

const requirePerm = (perm) => createMiddleware(async (c, next) => {
  const h = c.req.header('authorization')
  if (!h || !h.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401)
  const user = sessions.get(h.slice(7))
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.permissions.includes(perm)) return c.json({ error: 'forbidden' }, 403)
  c.set('user', user)
  await next()
})
const hook = (result, c) => { if (!result.success) return c.json({ error: 'invalid ' + result.error.issues[0]?.path.join('.') }, 400) }

const UserOut = z.object({ id: z.string(), name: z.string(), email: z.string() })
const Body = z.object({ name: z.string().min(1).max(100), email: z.email().max(200), age: z.number().int().min(0).max(150) })
const Created = Body.extend({ id: z.string() })

export const app = new Hono()
  .get('/health', (c) => c.json({ ok: true }))
  .get('/users/:id', requirePerm('users:read'),
    zValidator('param', z.object({ id: z.string().min(1).max(10).regex(/^[0-9]+$/) }), hook),
    (c) => {
      const u = users.get(c.req.valid('param').id)
      if (!u) return c.json({ error: 'User not found' }, 404)
      return c.json(UserOut.parse(u))
    })
  .post('/users', requirePerm('users:write'), zValidator('json', Body, hook),
    (c) => c.json(Created.parse({ id: '1001', ...c.req.valid('json') }), 201))
app.notFound((c) => c.json({ error: 'not found' }, 404))
