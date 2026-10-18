import { Hono } from 'hono'
import { HTTPException } from 'hono/http-exception'
import { secureHeaders } from 'hono/secure-headers'
import { db } from './db.js'
import { z } from 'zod'
import { getConnInfo } from '@hono/node-server/conninfo'

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

// ---------- brute-force protection ----------
//
// Failed logins are counted in fixed windows under three keys:
//   - client IP + email : stops guessing one account from one place (tight limit)
//   - client IP         : stops one client spraying many accounts
//   - email             : stops a distributed attack on one account
// When a key reaches its limit it is locked until the window ends; while any key is locked,
// login attempts are refused with 429 *before* the password is checked, so a locked-out
// attacker learns nothing even with the right password. A successful login clears the
// IP+email counter. State is in memory (per process); use a shared store when scaling out.

const WINDOW_MS = 15 * 60 * 1000
const LIMITS = { ipEmail: 5, ip: 20, email: 20 }
const MAX_TRACKED_KEYS = 50_000

const failures = new Map() // key -> { count, resetAt }

const pruneExpired = (now) => {
  for (const [key, entry] of failures) if (entry.resetAt <= now) failures.delete(key)
  // Hard cap so a flood of unique keys cannot exhaust memory: drop the oldest entries.
  while (failures.size > MAX_TRACKED_KEYS) failures.delete(failures.keys().next().value)
}

const lockedFor = (key, limit, now) => {
  const entry = failures.get(key)
  if (!entry || entry.resetAt <= now || entry.count < limit) return 0
  return entry.resetAt - now
}

const recordFailure = (key, now) => {
  const entry = failures.get(key)
  if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS })
  else entry.count += 1
}

// The socket address is used by default; X-Forwarded-For is only trusted when the app is
// explicitly told it sits behind a proxy (TRUST_PROXY=1), otherwise clients could spoof it.
const clientIp = (c) => {
  if (process.env.TRUST_PROXY === '1') {
    const forwarded = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
  }
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

let requestsSincePrune = 0

// ---------- routes ----------

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'email is required').max(254),
  password: z.string().min(1, 'password is required').max(1024),
})

const INVALID_CREDENTIALS = 'Invalid email or password'

app.post('/auth/login', async (c) => {
  c.header('Cache-Control', 'no-store')
  const now = Date.now()
  if (++requestsSincePrune >= 1000 || failures.size > MAX_TRACKED_KEYS) {
    requestsSincePrune = 0
    pruneExpired(now)
  }

  const ip = clientIp(c)
  // Throttle by IP before even parsing the body.
  const ipWait = lockedFor(`ip:${ip}`, LIMITS.ip, now)
  if (ipWait > 0) return tooManyAttempts(c, ipWait)

  const { email, password } = await readBody(c, loginSchema)
  const keys = { ipEmail: `ipe:${ip}|${email}`, ip: `ip:${ip}`, email: `e:${email}` }

  const wait = Math.max(
    lockedFor(keys.ipEmail, LIMITS.ipEmail, now),
    lockedFor(keys.email, LIMITS.email, now),
  )
  if (wait > 0) return tooManyAttempts(c, wait)

  const user = db.users.findByEmail(email)
  // Same response for unknown email and wrong password: no account enumeration.
  if (!user || !db.verifyPassword(user, password)) {
    for (const key of Object.values(keys)) recordFailure(key, now)
    return c.json({ error: INVALID_CREDENTIALS }, 401)
  }

  failures.delete(keys.ipEmail)
  const token = db.sessions.create(user.id)
  return c.json({ token, tokenType: 'Bearer', user: publicUser(user) })
})

function tooManyAttempts(c, waitMs) {
  c.header('Retry-After', String(Math.ceil(waitMs / 1000)))
  return c.json({ error: 'Too many failed login attempts. Try again later.' }, 429)
}

export default app
