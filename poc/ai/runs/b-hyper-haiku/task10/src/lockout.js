// Brute-force protection for login, per account (normalized email).
// After MAX_FAILURES wrong passwords inside WINDOW_MS, the account is locked for LOCK_MS.
// State lives in memory, so it resets when the server restarts.

const MAX_FAILURES = 5
const WINDOW_MS = 15 * 60 * 1000
const LOCK_MS = 15 * 60 * 1000
const PRUNE_AT = 10000

const entries = new Map() // key -> { failures, windowStart, lockedUntil }

function prune(now) {
  if (entries.size < PRUNE_AT) return
  for (const [key, e] of entries) {
    if (e.lockedUntil <= now && now - e.windowStart > WINDOW_MS) entries.delete(key)
  }
}

export const lockout = {
  // milliseconds until the key is unlocked, 0 when it is not locked
  lockedFor(key, now = Date.now()) {
    const e = entries.get(key)
    return e && e.lockedUntil > now ? e.lockedUntil - now : 0
  },

  recordFailure(key, now = Date.now()) {
    prune(now)
    let e = entries.get(key)
    if (!e || now - e.windowStart > WINDOW_MS) {
      e = { failures: 0, windowStart: now, lockedUntil: 0 }
      entries.set(key, e)
    }
    e.failures += 1
    if (e.failures >= MAX_FAILURES) {
      e.lockedUntil = now + LOCK_MS
      e.failures = 0
      e.windowStart = now
    }
  },

  reset(key) {
    entries.delete(key)
  },
}
