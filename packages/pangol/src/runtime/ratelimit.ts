// In-memory rate limit (SPEC section 5, v0.1): a sliding window approximated from two fixed
// windows. Memory is bounded: past maxKeys callers the window rotates early, so at most
// 2 * maxKeys keys are held however many addresses an attacker cycles through (audit C5).

const WINDOWS = { s: 1_000, sec: 1_000, m: 60_000, min: 60_000, h: 3_600_000, hour: 3_600_000 } as const
const SPEC = /^([1-9][0-9]{0,8})\/(s|sec|m|min|h|hour)$/

export interface Limiter {
  /** Count one request for this caller; false means over the limit. */
  hit(key: string): boolean
  size(): number
}

export function createLimiter(spec: string, { maxKeys = 100_000, now = Date.now }: { maxKeys?: number; now?: () => number } = {}): Limiter {
  const m = typeof spec === 'string' ? SPEC.exec(spec) : null
  if (m === null) throw new TypeError(`invalid rateLimit ${JSON.stringify(spec)}: use '<count>/<s|min|h>', e.g. '10/min'`)
  const max = Number(m[1])
  const window = WINDOWS[m[2] as keyof typeof WINDOWS]
  let current = new Map<string, number>()
  let previous = new Map<string, number>()
  let start = now()
  return {
    hit(key) {
      const t = now()
      if (t - start >= 2 * window) { previous = new Map(); current = new Map(); start = t }
      else if (t - start >= window) { previous = current; current = new Map(); start += window }
      if (current.size >= maxKeys && !current.has(key)) { previous = current; current = new Map(); start = t }
      const count = (current.get(key) ?? 0) + 1
      current.set(key, count)
      return count + (previous.get(key) ?? 0) * (1 - (t - start) / window) <= max
    },
    size: () => current.size + previous.size,
  }
}
