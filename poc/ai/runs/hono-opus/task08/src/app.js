import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

const err = (c, status, error) => c.json({ error }, status)

// Returns { user } on success, or { status } (401) when header missing or token invalid.
const authenticate = (c) => {
  const h = c.req.header('Authorization')
  if (h === undefined) return { status: 401, missing: true }
  const m = /^Bearer[ ]+(\S+)\s*$/i.exec(h.trim())
  if (!m) return { status: 401 }
  const user = db.sessions.userForToken(m[1])
  if (!user) return { status: 401 }
  return { user }
}

const requireUser = (c) => {
  const a = authenticate(c)
  if (!a.user) return { res: err(c, 401, 'Unauthorized') }
  return { user: a.user }
}

const readBody = async (c) => {
  try {
    const b = await c.req.json()
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return undefined
    return b
  } catch {
    return undefined
  }
}

const isEmail = (s) =>
  typeof s === 'string' && s.length <= 254 && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s)

app.notFound((c) => err(c, 404, 'Not found'))
app.onError((e, c) => err(c, 500, 'Internal server error'))

app.post('/orders', async (c) => {
  const { user, res } = requireUser(c)
  if (res) return res
  const body = await readBody(c)
  if (!body) return err(c, 400, 'Invalid JSON body')
  const { productId, quantity } = body
  if (typeof productId !== 'string' || productId.length === 0)
    return err(c, 400, 'productId must be a string')
  if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > 10)
    return err(c, 400, 'quantity must be a whole number from 1 to 10')
  const product = db.products.get(productId)
  if (!product) return err(c, 404, 'Product not found')
  const total = Math.round((product.price * quantity + Number.EPSILON) * 100) / 100
  if (!db.products.takeStock(product.id, quantity)) return err(c, 409, 'Not enough stock')
  const o = db.orders.create({ userId: user.id, productId: product.id, quantity, total })
  return c.json({ id: o.id, productId: o.productId, quantity: o.quantity, total: o.total }, 201)
})

export default app
