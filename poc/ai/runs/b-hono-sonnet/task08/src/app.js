import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

const fail = (c, status, error) => c.json({ error }, status)

const publicUser = ({ passwordHash, ...rest }) => rest

// Returns the signed-in user, null when no credentials were sent, or undefined when they are invalid.
function authenticate(c) {
  const header = c.req.header('authorization')
  if (!header) return null
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header)
  if (!m) return undefined
  return db.sessions.userForToken(m[1])
}

const requireAuth = async (c, next) => {
  const user = authenticate(c)
  if (!user) return fail(c, 401, 'Authentication required')
  c.set('user', user)
  await next()
}

const requirePermission = (permission) => async (c, next) => {
  if (!c.get('user').permissions.includes(permission)) return fail(c, 403, 'Forbidden')
  await next()
}

async function readJson(c) {
  try {
    const body = await c.req.json()
    return body && typeof body === 'object' && !Array.isArray(body) ? body : undefined
  } catch {
    return undefined
  }
}

app.notFound((c) => fail(c, 404, 'Not found'))
app.onError((err, c) => {
  console.error(err)
  return fail(c, 500, 'Internal server error')
})

const MAX_QUANTITY = 10

app.post('/orders', requireAuth, async (c) => {
  const body = await readJson(c)
  if (!body) return fail(c, 400, 'Body must be a JSON object')
  const { productId, quantity } = body
  if ((typeof productId !== 'string' && typeof productId !== 'number') || String(productId).trim() === '') {
    return fail(c, 400, 'productId is required')
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_QUANTITY) {
    return fail(c, 400, `quantity must be an integer between 1 and ${MAX_QUANTITY}`)
  }
  const product = db.products.get(String(productId).trim())
  if (!product) return fail(c, 404, 'Product not found')
  // takeStock is atomic: it refuses when stock is insufficient.
  if (!db.products.takeStock(product.id, quantity)) return fail(c, 409, 'Insufficient stock')
  const total = Math.round(Math.round(product.price * 100) * quantity) / 100
  const { paymentToken, ...order } = db.orders.create({
    userId: c.get('user').id,
    productId: product.id,
    quantity,
    total,
  })
  return c.json(order, 201)
})

export default app
