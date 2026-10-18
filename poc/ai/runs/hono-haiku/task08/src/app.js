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

// The JSON body if it is an object, otherwise undefined.
const readBody = async (c) => {
  try {
    const data = await c.req.json()
    return data !== null && typeof data === 'object' && !Array.isArray(data) ? data : undefined
  } catch {
    return undefined
  }
}

const signedIn = async (c, next) => {
  if (!userFrom(c)) return c.json({ error: 'Sign in required' }, 401)
  await next()
}

app.post('/orders', signedIn, async (c) => {
  const user = userFrom(c)
  const input = await readBody(c)
  if (!input) return c.json({ error: 'Request body must be a JSON object' }, 400)

  const { productId, quantity } = input
  if (typeof productId !== 'string' || productId.length < 1) {
    return c.json({ error: 'productId must be a non-empty string' }, 400)
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
    return c.json({ error: 'quantity must be a whole number from 1 to 10' }, 400)
  }

  const product = db.products.get(productId)
  if (!product) return c.json({ error: 'Product not found' }, 404)
  if (!db.products.takeStock(product.id, quantity)) {
    return c.json({ error: 'Not enough stock' }, 409)
  }

  const total = Math.round(product.price * quantity * 100) / 100
  const order = db.orders.create({ userId: user.id, productId: product.id, quantity, total })
  return c.json({ id: order.id, productId: order.productId, quantity: order.quantity, total: order.total }, 201)
})

export default app
