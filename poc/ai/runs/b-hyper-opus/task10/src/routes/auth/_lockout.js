// Per-account brute-force protection (complements the per-IP rateLimit on the route).
const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const MAX_ENTRIES = 100000

const attempts = new Map() // key -> { failures, firstAt, lockedUntil }

const keyFor = (email) => String(email).trim().toLowerCase()

export function isLocked(email, now = Date.now()) {
  const a = attempts.get(keyFor(email))
  return !!a && a.lockedUntil > now
}

export function recordFailure(email, now = Date.now()) {
  const key = keyFor(email)
  let a = attempts.get(key)
  if (!a || now - a.firstAt > WINDOW_MS) {
    if (!a && attempts.size >= MAX_ENTRIES) prune(now)
    a = { failures: 0, firstAt: now, lockedUntil: 0 }
    attempts.set(key, a)
  }
  a.failures += 1
  if (a.failures >= MAX_FAILURES) {
    a.lockedUntil = now + LOCK_MS
    a.failures = 0
    a.firstAt = now
  }
}

export function recordSuccess(email) {
  attempts.delete(keyFor(email))
}

function prune(now) {
  for (const [k, a] of attempts) {
    if (a.lockedUntil <= now && now - a.firstAt > WINDOW_MS) attempts.delete(k)
  }
  // Still full: drop oldest entries to bound memory.
  while (attempts.size >= MAX_ENTRIES) attempts.delete(attempts.keys().next().value)
}
