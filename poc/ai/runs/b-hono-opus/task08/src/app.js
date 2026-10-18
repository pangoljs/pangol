import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { db } from './db.js'
import { z } from 'zod'

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

const MAX_BODY_BYTES = 16 * 1024

// Parses the JSON request body (size-limited) and validates it against a zod schema.
// Throws a 400 / 413 HTTPException on bad input.
const readBody = async (c, schema) => {
  const declared = Number(c.req.header('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw new HTTPException(413, { message: 'Request body too large' })
  }
  const text = await c.req.text()
  if (text.length > MAX_BODY_BYTES) throw new HTTPException(413, { message: 'Request body too large' })
  let data
  try {
    data = JSON.parse(text)
  } catch {
    throw new HTTPException(400, { message: 'Request body must be valid JSON' })
  }
  const result = schema.safeParse(data)
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.') || null, message: i.message }))
    throw Object.assign(new HTTPException(400, { message: 'Invalid input' }), { details })
  }
  return result.data
}

// ---------- routes ----------

const MAX_QUANTITY = 10

const createOrderSchema = z.object({
  productId: z.union([z.string().regex(/^\d{1,20}$/, 'productId must be a product id'), z.number().int().positive()])
    .transform(String),
  quantity: z
    .number({ error: 'quantity must be a number' })
    .int('quantity must be a whole number')
    .min(1, 'quantity must be at least 1')
    .max(MAX_QUANTITY, `quantity cannot exceed ${MAX_QUANTITY} per order`),
})

// Never expose the internal payment token.
const publicOrder = (o) => ({ id: o.id, userId: o.userId, productId: o.productId, quantity: o.quantity, total: o.total })

// Place an order for the signed-in customer. The price always comes from the catalogue, never the client.
app.post('/orders', requireAuth, async (c) => {
  const user = c.get('user')
  const { productId, quantity } = await readBody(c, createOrderSchema)

  const product = db.products.get(productId)
  if (!product) return c.json({ error: 'Product not found' }, 404)

  // Work in integer cents to avoid floating-point drift.
  const total = (Math.round(product.price * 100) * quantity) / 100

  if (!db.products.takeStock(product.id, quantity)) {
    return c.json({ error: 'Not enough stock for this product' }, 409)
  }

  const order = db.orders.create({ userId: user.id, productId: product.id, quantity, total })
  c.header('Location', `/orders/${order.id}`)
  return c.json(publicOrder(order), 201)
})

export default app
