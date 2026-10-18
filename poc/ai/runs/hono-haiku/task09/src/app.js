import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

app.notFound((c) => c.json({ error: 'Not found' }, 404))
app.onError((err, c) => c.json({ error: 'Internal server error' }, 500))

// The user for the Authorization: Bearer token, or undefined.
const userFrom = (c) => {
  const match = /^Bearer\s+(\S+)$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

const signedIn = async (c, next) => {
  if (!userFrom(c)) return c.json({ error: 'Sign in required' }, 401)
  await next()
}

app.get('/orders/:id', signedIn, (c) => {
  const user = userFrom(c)
  const order = db.orders.get(c.req.param('id'))
  if (!order) return c.json({ error: 'Order not found' }, 404)
  if (order.userId !== user.id) return c.json({ error: 'Forbidden' }, 403)
  const { id, productId, quantity, total } = order
  return c.json({ id, productId, quantity, total })
})

export default app
