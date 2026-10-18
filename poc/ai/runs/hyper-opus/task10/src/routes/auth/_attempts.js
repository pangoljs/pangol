// Failed login tracking per email (lower-cased). Lives as long as the server runs.
export const WINDOW_MS = 15 * 60 * 1000
export const MAX_FAILURES = 5

const failures = new Map() // email -> number[] (timestamps of failed attempts)
const lockedUntil = new Map() // email -> timestamp

export function isLocked(email, now = Date.now()) {
  const until = lockedUntil.get(email)
  if (until === undefined) return false
  if (now < until) return true
  lockedUntil.delete(email)
  failures.delete(email)
  return false
}

export function recordFailure(email, now = Date.now()) {
  const recent = (failures.get(email) || []).filter((ts) => now - ts < WINDOW_MS)
  recent.push(now)
  failures.set(email, recent)
  if (recent.length >= MAX_FAILURES) lockedUntil.set(email, now + WINDOW_MS)
}
