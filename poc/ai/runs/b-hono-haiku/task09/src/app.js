import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

// The user behind the Bearer token, or undefined if the token is missing or unknown.
function currentUser(c) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

// Payment tokens are internal and never returned.
const publicOrder = ({ paymentToken, ...order }) => order

app.get('/orders/:id', (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'Not signed in' }, 401)

  const order = db.orders.get(c.req.param('id'))
  if (!order) return c.json({ error: 'Order not found' }, 404)
  if (order.userId !== user.id) return c.json({ error: 'Forbidden' }, 403)

  return c.json(publicOrder(order))
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
