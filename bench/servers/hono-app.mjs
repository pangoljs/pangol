// The benchmark API in Hono: middleware for auth, and validation and response filtering written by
// hand (Hono's fastest case; an idiomatic zod validator would be slower), so the comparison favours Hono.
import { Hono } from 'hono'
import { createMiddleware } from 'hono/factory'
import { canRead, sessions, users } from '../shared/data.mjs'

const requirePerm = (perm) => createMiddleware(async (c, next) => {
  const h = c.req.header('authorization')
  if (!h || !h.startsWith('Bearer ')) return c.json({ error: 'unauthorized' }, 401)
  const user = sessions.get(h.slice(7))
  if (!user) return c.json({ error: 'unauthorized' }, 401)
  if (!user.permissions.includes(perm)) return c.json({ error: 'forbidden' }, 403)
  c.set('user', user)
  await next()
})
const EMAIL = /^[^\s@]+@[^\s@]+$/
const validBody = (b) => typeof b === 'object' && b !== null && !Array.isArray(b) &&
  typeof b.name === 'string' && b.name.length >= 1 && b.name.length <= 100 &&
  typeof b.email === 'string' && b.email.length <= 200 && EMAIL.test(b.email) &&
  Number.isInteger(b.age) && b.age >= 0 && b.age <= 150

export const app = new Hono()
  .get('/health', (c) => c.json({ ok: true }))
  .get('/users/:id', requirePerm('users:read'), (c) => {
    const id = c.req.param('id')
    if (id.length > 10 || !/^[0-9]+$/.test(id)) return c.json({ error: 'invalid id' }, 400)
    const u = users.get(id)
    if (!u || !canRead(c.get('user'), u)) return c.json({ error: 'not found' }, 404)
    return c.json({ id: u.id, name: u.name, email: u.email })
  })
  .post('/users', requirePerm('users:write'), async (c) => {
    if (c.req.header('content-type') !== 'application/json') return c.json({ error: 'expected application/json' }, 415)
    let b
    try { b = await c.req.json() } catch { return c.json({ error: 'invalid json' }, 400) }
    if (!validBody(b)) return c.json({ error: 'invalid body' }, 400)
    return c.json({ id: '1001', name: b.name, email: b.email, age: b.age }, 201)
  })
app.notFound((c) => c.json({ error: 'not found' }, 404))
