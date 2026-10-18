import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { db } from './db.js'

const app = new Hono()

app.use('*', secureHeaders())

// ---------- shared helpers ----------

const BEARER_RE = /^Bearer[ \t]+([A-Za-z0-9._~+/=-]+)[ \t]*$/i

// Returns the signed-in user for the request, or undefined.
const currentUser = (c) => {
  const match = BEARER_RE.exec(c.req.header('authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

const unauthorized = (c) => {
  c.header('WWW-Authenticate', 'Bearer')
  return c.json({ error: 'Authentication required' }, 401)
}

// Middleware: rejects the request with 401 unless a valid session token is supplied.
const requireAuth = async (c, next) => {
  const user = currentUser(c)
  if (!user) return unauthorized(c)
  c.set('user', user)
  await next()
}

const hasPermission = (user, permission) =>
  Array.isArray(user?.permissions) && user.permissions.includes(permission)

// Only these fields are ever sent to clients (never passwordHash).
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role })

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    const body = { error: err.message || 'Request failed' }
    if (err.details) body.details = err.details
    return c.json(body, err.status)
  }
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

// ---------- routes ----------

// Never expose the internal payment token.
const publicOrder = (o) => ({ id: o.id, userId: o.userId, productId: o.productId, quantity: o.quantity, total: o.total })

// A customer can view their own orders only. Other people's orders are reported as not found
// so order ids cannot be probed.
app.get('/orders/:id', requireAuth, (c) => {
  const user = c.get('user')
  const order = db.orders.get(c.req.param('id'))
  if (!order || order.userId !== user.id) return c.json({ error: 'Order not found' }, 404)

  c.header('Cache-Control', 'private, no-store')
  return c.json(publicOrder(order))
})

export default app
