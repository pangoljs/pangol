// Money as bigint minor units (1250n at scale 2 is 12.50). The wire format is a decimal string, so
// a float never touches an amount. Every operation that can lose a fraction takes a rounding mode.

/** The rounding modes of Intl.NumberFormat (`roundingMode`). There is no default: callers choose. */
export type Rounding = 'ceil' | 'floor' | 'expand' | 'trunc' | 'halfCeil' | 'halfFloor' | 'halfExpand' | 'halfTrunc' | 'halfEven'

const ROUNDINGS: ReadonlySet<string> = new Set<Rounding>(['ceil', 'floor', 'expand', 'trunc', 'halfCeil', 'halfFloor', 'halfExpand', 'halfTrunc', 'halfEven'])
export const MAX_SCALE = 18
// Longer than any amount a real system stores; checked before the regex so huge input is cheap to refuse.
const MAX_LENGTH = 64
const DECIMAL = /^(-?)(0|[1-9][0-9]*)(?:\.([0-9]+))?$/

export function checkScale(scale: number, where = 'money'): number {
  if (!Number.isSafeInteger(scale) || scale < 0 || scale > MAX_SCALE) {
    throw new RangeError(`${where}: scale must be an integer from 0 to ${MAX_SCALE}, got ${String(scale)}`)
  }
  return scale
}

/** A canonical decimal ("12.50", "-3", never "012", "+1", "1e3", "-0") as units and decimal places. */
function decimal(text: string): { units: bigint; places: number } | undefined {
  if (text.length > MAX_LENGTH) return undefined
  const m = DECIMAL.exec(text)
  if (m === null) return undefined
  const [, sign, whole = '', fraction = ''] = m
  const units = BigInt(whole + fraction)
  if (sign === '-' && units === 0n) return undefined
  return { units: sign === '-' ? -units : units, places: fraction.length }
}

/** Minor units for `text` at `scale`, or undefined when it is not a canonical amount at that scale. */
export function toMinor(text: string, scale: number): bigint | undefined {
  const d = decimal(text)
  if (d === undefined || d.places > scale) return undefined
  return d.places === scale ? d.units : d.units * 10n ** BigInt(scale - d.places)
}

export function toDecimal(minor: bigint, scale: number): string {
  const negative = minor < 0n
  const digits = (negative ? -minor : minor).toString()
  if (scale === 0) return negative ? '-' + digits : digits
  const padded = digits.padStart(scale + 1, '0')
  return (negative ? '-' : '') + padded.slice(0, -scale) + '.' + padded.slice(-scale)
}

function bigintArg(value: unknown, name: string): bigint {
  if (typeof value !== 'bigint') throw new TypeError(`money: ${name} must be a bigint, got ${typeof value}`)
  return value
}

function roundingArg(mode: unknown): Rounding {
  if (typeof mode !== 'string' || !ROUNDINGS.has(mode)) {
    throw new TypeError(`money: rounding must be one of ${[...ROUNDINGS].join(', ')}, got ${String(mode)}`)
  }
  return mode as Rounding
}

/** n / d rounded by `mode`. */
function divide(n: bigint, d: bigint, mode: Rounding): bigint {
  if (d < 0n) { n = -n; d = -d }
  const q = n / d // truncated toward zero
  const r = n % d
  if (r === 0n) return q
  const positive = n > 0n
  const away = positive ? q + 1n : q - 1n
  switch (mode) {
    case 'trunc': return q
    case 'expand': return away
    case 'ceil': return positive ? away : q
    case 'floor': return positive ? q : away
  }
  const twice = 2n * (r < 0n ? -r : r)
  if (twice !== d) return twice > d ? away : q
  switch (mode) {
    case 'halfTrunc': return q
    case 'halfExpand': return away
    case 'halfCeil': return positive ? away : q
    case 'halfFloor': return positive ? q : away
    case 'halfEven': return q % 2n === 0n ? q : away
  }
}

export const money = Object.freeze({
  /** "12.50" -> 1250n at scale 2. Throws a RangeError instead of rounding extra decimals. */
  parse(text: string, scale = 2): bigint {
    if (typeof text !== 'string') throw new TypeError(`money.parse: expected a decimal string, got ${typeof text}`)
    const minor = toMinor(text, checkScale(scale, 'money.parse'))
    if (minor === undefined) throw new RangeError(`money.parse: ${JSON.stringify(text.slice(0, MAX_LENGTH))} is not an amount with at most ${scale} decimals`)
    return minor
  },

  /** 1250n -> "12.50" at scale 2: always exactly `scale` decimals. */
  format(minor: bigint, scale = 2): string {
    return toDecimal(bigintArg(minor, 'amount'), checkScale(scale, 'money.format'))
  },

  /** amount * factor, where factor is an exact decimal string such as "0.07" (never a float). */
  mul(minor: bigint, factor: string, rounding: Rounding): bigint {
    bigintArg(minor, 'amount')
    if (typeof factor !== 'string') throw new TypeError(`money.mul: factor must be a decimal string such as "0.07", got ${typeof factor}`)
    const mode = roundingArg(rounding)
    const f = decimal(factor)
    if (f === undefined) throw new RangeError(`money.mul: ${JSON.stringify(factor.slice(0, MAX_LENGTH))} is not a decimal number`)
    return divide(minor * f.units, 10n ** BigInt(f.places), mode)
  },

  /** amount / divisor. */
  div(minor: bigint, divisor: bigint, rounding: Rounding): bigint {
    bigintArg(minor, 'amount')
    bigintArg(divisor, 'divisor')
    const mode = roundingArg(rounding)
    if (divisor === 0n) throw new RangeError('money.div: cannot divide by zero')
    return divide(minor, divisor, mode)
  },

  /**
   * Split `minor` by `ratios` so the parts always add up to it exactly. The minor units left after
   * truncating are given one each to the first parts with a non-zero ratio.
   */
  allocate(minor: bigint, ratios: readonly bigint[]): bigint[] {
    bigintArg(minor, 'amount')
    let sum = 0n
    for (const r of ratios) {
      if (bigintArg(r, 'ratio') < 0n) throw new RangeError('money.allocate: ratios cannot be negative')
      sum += r
    }
    if (sum === 0n) throw new RangeError('money.allocate: needs at least one ratio above zero')
    const parts = ratios.map((r) => (minor * r) / sum)
    const unit = minor < 0n ? -1n : 1n
    let rest = minor - parts.reduce((a, b) => a + b, 0n)
    // |rest| is below the number of non-zero ratios, so one pass is enough
    for (let i = 0; rest !== 0n; i++) {
      if (ratios[i] === 0n) continue
      parts[i] = (parts[i] as bigint) + unit
      rest -= unit
    }
    return parts
  },
})
