// In-memory database for the exercise. Every server start begins from this exact data.
// All functions are synchronous. Returned records are copies: change data only through the
// functions below. IDs are strings.

const users = new Map([
  ['1', { id: '1', name: 'Alice', email: 'alice@example.com', role: 'admin', passwordHash: 'hash:alice-pass', permissions: ['users:read', 'users:write', 'posts:moderate'] }],
  ['2', { id: '2', name: 'Bob', email: 'bob@example.com', role: 'member', passwordHash: 'hash:bob-pass', permissions: [] }],
  ['3', { id: '3', name: 'Carol', email: 'carol@example.com', role: 'member', passwordHash: 'hash:carol-pass', permissions: [] }],
  ['4', { id: '4', name: 'Dave', email: 'dave@example.com', role: 'member', passwordHash: 'hash:dave-pass', permissions: ['users:read'] }],
])
const posts = new Map([
  ['1', { id: '1', authorId: '2', title: 'Hello from Bob', body: 'First post', published: true }],
  ['2', { id: '2', authorId: '2', title: 'Bob draft', body: 'Not ready yet', published: false }],
  ['3', { id: '3', authorId: '3', title: 'Carol writes', body: 'Some text', published: true }],
])
const products = new Map([
  ['1', { id: '1', name: 'Widget', price: 9.99, stock: 5 }],
  ['2', { id: '2', name: 'Gadget', price: 24.5, stock: 0 }],
])
const orders = new Map([
  ['1', { id: '1', userId: '2', productId: '1', quantity: 2, total: 19.98, paymentToken: 'tok_secret_bob_1' }],
  ['2', { id: '2', userId: '3', productId: '1', quantity: 1, total: 9.99, paymentToken: 'tok_secret_carol_2' }],
])
const sessions = new Map([['t-alice', '1'], ['t-bob', '2'], ['t-carol', '3'], ['t-dave', '4']])

const copy = (x) => (x === undefined ? undefined : structuredClone(x))
const nextId = (m) => String(Math.max(0, ...[...m.keys()].map(Number)) + 1)

export const db = {
  users: {
    all: () => [...users.values()].map(copy),
    get: (id) => copy(users.get(String(id))),
    findByEmail: (email) => copy([...users.values()].find((u) => u.email.toLowerCase() === String(email).toLowerCase())),
    // create({ name, email, role, passwordHash?, permissions? }) -> new user
    create: (data) => {
      const u = { permissions: [], passwordHash: null, ...data, id: nextId(users) }
      users.set(u.id, u)
      return copy(u)
    },
    update: (id, patch) => {
      const u = users.get(String(id))
      if (!u) return undefined
      Object.assign(u, patch, { id: u.id })
      return copy(u)
    },
  },
  posts: {
    all: () => [...posts.values()].map(copy),
    get: (id) => copy(posts.get(String(id))),
    update: (id, patch) => {
      const p = posts.get(String(id))
      if (!p) return undefined
      Object.assign(p, patch, { id: p.id })
      return copy(p)
    },
    delete: (id) => posts.delete(String(id)), // true if it existed
  },
  products: {
    get: (id) => copy(products.get(String(id))),
    // removes stock; returns false (and changes nothing) if there is not enough
    takeStock: (id, quantity) => {
      const p = products.get(String(id))
      if (!p || p.stock < quantity) return false
      p.stock -= quantity
      return true
    },
  },
  orders: {
    get: (id) => copy(orders.get(String(id))),
    // create({ userId, productId, quantity, total }) -> order (a paymentToken is attached internally)
    create: (data) => {
      const id = nextId(orders)
      const o = { ...data, id, paymentToken: `tok_secret_${id}_${Math.random().toString(36).slice(2)}` }
      orders.set(id, o)
      return copy(o)
    },
  },
  sessions: {
    // token -> user (with permissions) or undefined
    userForToken: (token) => copy(users.get(sessions.get(String(token)))),
    // creates a new session for the user and returns its token
    create: (userId) => {
      const token = 't-' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2)
      sessions.set(token, String(userId))
      return token
    },
  },
  // true if the plain-text password matches the user's passwordHash
  verifyPassword: (user, password) => !!user && typeof password === 'string' && user.passwordHash === 'hash:' + password,
}
