import { Hono } from 'hono'
import { z } from 'zod'
import { db } from './db.js'

const app = new Hono()

// Brute-force protection: failed logins are counted per email and per client address in a
// fixed window. Once a counter reaches its limit, logins for that key get 429 until the window ends.
const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILURES_PER_EMAIL = 5
const MAX_FAILURES_PER_IP = 30

// key -> { count, resetAt }
const failures = new Map()

// Seconds until the key is unblocked, or 0 if it is not blocked.
function secondsBlocked(key, max, now) {
  const entry = failures.get(key)
  if (!entry || entry.resetAt <= now) {
    failures.delete(key)
    return 0
  }
  return entry.count >= max ? Math.ceil((entry.resetAt - now) / 1000) : 0
}

function recordFailure(key, now) {
  if (failures.size > 10_000) {
    for (const [k, entry] of failures) if (entry.resetAt <= now) failures.delete(k)
  }
  const entry = failures.get(key)
  if (!entry || entry.resetAt <= now) failures.set(key, { count: 1, resetAt: now + WINDOW_MS })
  else entry.count += 1
}

// The socket address cannot be spoofed by the client, unlike X-Forwarded-For.
function clientAddress(c) {
  return c.env?.incoming?.socket?.remoteAddress ?? 'unknown'
}

const credentials = z.object({
  email: z.string().trim().min(1).max(254),
  password: z.string().min(1).max(200),
})

async function readJson(c) {
  try {
    return await c.req.json()
  } catch {
    return undefined
  }
}

app.post('/auth/login', async (c) => {
  const parsed = credentials.safeParse(await readJson(c))
  if (!parsed.success) return c.json({ error: 'Invalid input', details: parsed.error.issues }, 400)

  const email = parsed.data.email.toLowerCase()
  const emailKey = `email:${email}`
  const ipKey = `ip:${clientAddress(c)}`
  const now = Date.now()

  const retryAfter = Math.max(
    secondsBlocked(emailKey, MAX_FAILURES_PER_EMAIL, now),
    secondsBlocked(ipKey, MAX_FAILURES_PER_IP, now),
  )
  if (retryAfter > 0) {
    c.header('Retry-After', String(retryAfter))
    return c.json({ error: 'Too many failed login attempts. Try again later.' }, 429)
  }

  // Unknown emails count as failures too, so the response does not reveal which emails exist.
  const user = db.users.findByEmail(email)
  if (!db.verifyPassword(user, parsed.data.password)) {
    recordFailure(emailKey, now)
    recordFailure(ipKey, now)
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  failures.delete(emailKey)
  return c.json({ token: db.sessions.create(user.id) })
})

app.notFound((c) => c.json({ error: 'Not found' }, 404))

app.onError((err, c) => {
  console.error(err)
  return c.json({ error: 'Internal server error' }, 500)
})

export default app
