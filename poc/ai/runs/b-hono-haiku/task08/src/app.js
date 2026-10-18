import { Hono } from 'hono'
import { z } from 'zod'
import { db } from './db.js'

const app = new Hono()

// The user behind the Bearer token, or undefined if the token is missing or unknown.
function currentUser(c) {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(c.req.header('Authorization') ?? '')
  return match ? db.sessions.userForToken(match[1]) : undefined
}

// Payment tokens are internal and never returned.
const publicOrder = ({ paymentToken, ...order }) => order

const newOrder = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(10),
})

async function readJson(c) {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

app.post('/orders', async (c) => {
  const user = currentUser(c)
  if (!user) return c.json({ error: 'Not signed in' }, 401)

  const parsed = newOrder.safeParse(await readJson(c))
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)
  const { productId, quantity } = parsed.data

  const product = db.products.get(productId)
  if (!product) return c.json({ error: 'Product not found' }, 404)

  // takeStock changes nothing when there is not enough stock.
  if (!db.products.takeStock(product.id, quantity)) {
    return c.json({ error: 'Not enough stock' }, 409)
  }

  const total = Math.round(product.price * quantity * 100) / 100
  const order = db.orders.create({ userId: user.id, productId: product.id, quantity, total })
  return c.json(publicOrder(order), 201)
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
