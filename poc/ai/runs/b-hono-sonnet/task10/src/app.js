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

import { getConnInfo } from '@hono/node-server/conninfo'

const WINDOW_MS = 15 * 60 * 1000
const MAX_FAILS_PER_ACCOUNT = 5
const MAX_FAILS_PER_IP = 20
const MAX_TRACKED = 10000

// key -> { count, resetAt } for failed attempts
const failures = new Map()

function current(key, now) {
  const e = failures.get(key)
  if (!e) return undefined
  if (e.resetAt <= now) {
    failures.delete(key)
    return undefined
  }
  return e
}

function recordFailure(key, now) {
  const e = current(key, now)
  if (e) {
    e.count++
    return
  }
  if (failures.size >= MAX_TRACKED) {
    for (const [k, v] of failures) if (v.resetAt <= now) failures.delete(k)
    if (failures.size >= MAX_TRACKED) failures.delete(failures.keys().next().value)
  }
  failures.set(key, { count: 1, resetAt: now + WINDOW_MS })
}

function clientIp(c) {
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

app.post('/auth/login', async (c) => {
  const body = await readJson(c)
  if (!body) return fail(c, 400, 'Body must be a JSON object')
  const { email, password } = body
  if (typeof email !== 'string' || !email.trim() || email.length > 254) return fail(c, 400, 'email is required')
  if (typeof password !== 'string' || !password || password.length > 1000) return fail(c, 400, 'password is required')

  const now = Date.now()
  const ipKey = `ip:${clientIp(c)}`
  const acctKey = `acct:${email.trim().toLowerCase()}`
  const ipEntry = current(ipKey, now)
  const acctEntry = current(acctKey, now)
  const blocked =
    (ipEntry && ipEntry.count >= MAX_FAILS_PER_IP ? ipEntry : null) ||
    (acctEntry && acctEntry.count >= MAX_FAILS_PER_ACCOUNT ? acctEntry : null)
  if (blocked) {
    c.header('Retry-After', String(Math.max(1, Math.ceil((blocked.resetAt - now) / 1000))))
    return fail(c, 429, 'Too many failed attempts, try again later')
  }

  const user = db.users.findByEmail(email.trim())
  if (!user || !db.verifyPassword(user, password)) {
    recordFailure(ipKey, now)
    recordFailure(acctKey, now)
    return fail(c, 401, 'Invalid email or password')
  }
  failures.delete(acctKey)
  return c.json({ token: db.sessions.create(user.id) })
})

export default app
