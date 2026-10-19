import fc from 'fast-check'
import { describe, expect, it } from 'vitest'
import { money } from '../src/index.js'
import type { Rounding } from '../src/index.js'

const ROUNDINGS: readonly Rounding[] = ['ceil', 'floor', 'expand', 'trunc', 'halfCeil', 'halfFloor', 'halfExpand', 'halfTrunc', 'halfEven']

describe('money.parse and money.format', () => {
  it('reads a decimal string into minor units', () => {
    expect(money.parse('12.50')).toBe(1250n)
    expect(money.parse('12.5')).toBe(1250n)
    expect(money.parse('12')).toBe(1200n)
    expect(money.parse('0.01')).toBe(1n)
    expect(money.parse('-3.07')).toBe(-307n)
    expect(money.parse('1000', 0)).toBe(1000n)
    expect(money.parse('1.234', 3)).toBe(1234n)
    expect(money.parse('90071992547409930.99')).toBe(9007199254740993099n) // past 2^53
  })

  it('rejects anything that is not one canonical decimal, instead of rounding or guessing', () => {
    for (const text of ['12.505', '1.5' + '0'.repeat(10), '012.50', '+1.00', '-0', '-0.00', '1e3', '1,000.00', ' 1.00', '1.00 ', '.5', '5.', '', '-', 'NaN', 'Infinity', '0x10', '１２']) {
      expect(() => money.parse(text), text).toThrow(RangeError)
    }
    expect(() => money.parse('1.5', 0)).toThrow(RangeError)
    expect(() => money.parse(12.5 as unknown as string)).toThrow(TypeError)
  })

  it('writes minor units with exactly `scale` decimals', () => {
    expect(money.format(1250n)).toBe('12.50')
    expect(money.format(1n)).toBe('0.01')
    expect(money.format(0n)).toBe('0.00')
    expect(money.format(-307n)).toBe('-3.07')
    expect(money.format(-7n)).toBe('-0.07')
    expect(money.format(1000n, 0)).toBe('1000')
    expect(money.format(5n, 3)).toBe('0.005')
    expect(() => money.format(12.5 as unknown as bigint)).toThrow(TypeError)
  })

  it('round-trips every amount', () => {
    fc.assert(fc.property(fc.bigInt({ min: -(10n ** 30n), max: 10n ** 30n }), fc.integer({ min: 0, max: 18 }), (minor, scale) => {
      expect(money.parse(money.format(minor, scale), scale)).toBe(minor)
    }))
  })

  it('rejects a scale it cannot use', () => {
    for (const scale of [-1, 1.5, 19, Number.NaN]) {
      expect(() => money.parse('1', scale)).toThrow(RangeError)
      expect(() => money.format(1n, scale)).toThrow(RangeError)
    }
  })
})

describe('money.div and money.mul round the way the caller says', () => {
  // Same table as Intl.NumberFormat's roundingMode, for 2.5, -2.5, 2.4 and 2.6 (units of 1).
  const table: Record<Rounding, [bigint, bigint, bigint, bigint]> = {
    ceil: [3n, -2n, 3n, 3n],
    floor: [2n, -3n, 2n, 2n],
    expand: [3n, -3n, 3n, 3n],
    trunc: [2n, -2n, 2n, 2n],
    halfCeil: [3n, -2n, 2n, 3n],
    halfFloor: [2n, -3n, 2n, 3n],
    halfExpand: [3n, -3n, 2n, 3n],
    halfTrunc: [2n, -2n, 2n, 3n],
    halfEven: [2n, -2n, 2n, 3n],
  }

  it('follows the Intl rounding modes', () => {
    for (const mode of ROUNDINGS) {
      expect([money.div(25n, 10n, mode), money.div(-25n, 10n, mode), money.div(24n, 10n, mode), money.div(26n, 10n, mode)], mode).toEqual(table[mode])
    }
    expect(money.div(35n, 10n, 'halfEven')).toBe(4n)
    expect(money.div(-35n, 10n, 'halfEven')).toBe(-4n)
    expect(money.div(25n, -10n, 'floor')).toBe(-3n)
  })

  it('matches Intl.NumberFormat on random quotients', () => {
    // divisors of 1000, so n / d is exact with 3 decimals and Intl can format it without a float
    const divisors = [1n, 2n, 4n, 5n, 8n, 10n, 20n, 25n, 40n, 50n, 100n, 125n, 200n, 250n, 500n, 1000n]
    fc.assert(fc.property(fc.bigInt({ min: -100_000n, max: 100_000n }), fc.constantFrom(...divisors), fc.constantFrom(...ROUNDINGS), (n, d, mode) => {
      // roundingMode and string input are ES2023 Intl; the configured lib predates them
      const intl = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0, roundingMode: mode, useGrouping: false } as Intl.NumberFormatOptions)
      const expected = intl.format(`${n * 1000n / d}E-3` as unknown as number)
      expect(money.div(n, d, mode)).toBe(BigInt(expected === '-0' ? '0' : expected))
    }))
  })

  it('multiplies by an exact decimal factor, never a float', () => {
    expect(money.mul(1999n, '0.07', 'halfExpand')).toBe(140n) // 139.93 -> 140
    expect(money.mul(1999n, '0.07', 'floor')).toBe(139n)
    expect(money.mul(1000n, '1.5', 'halfEven')).toBe(1500n)
    expect(money.mul(-1999n, '0.07', 'halfExpand')).toBe(-140n)
    expect(money.mul(5n, '0.5', 'halfEven')).toBe(2n)
    expect(() => money.mul(100n, 0.07 as unknown as string, 'halfEven')).toThrow(TypeError)
    expect(() => money.mul(100n, '7%', 'halfEven')).toThrow(RangeError)
  })

  it('requires an explicit rounding mode and a usable divisor', () => {
    expect(() => money.div(10n, 3n, undefined as unknown as Rounding)).toThrow(TypeError)
    expect(() => money.div(10n, 3n, 'nearest' as Rounding)).toThrow(TypeError)
    expect(() => money.div(10n, 0n, 'halfEven')).toThrow(RangeError)
    expect(() => money.div(10n, 3 as unknown as bigint, 'halfEven')).toThrow(TypeError)
  })
})

describe('money.allocate splits without losing a minor unit', () => {
  it('gives the remainder to the first parts', () => {
    expect(money.allocate(100n, [1n, 1n, 1n])).toEqual([34n, 33n, 33n])
    expect(money.allocate(5n, [3n, 7n])).toEqual([2n, 3n])
    expect(money.allocate(-100n, [1n, 1n, 1n])).toEqual([-34n, -33n, -33n])
    expect(money.allocate(100n, [0n, 1n])).toEqual([0n, 100n])
  })

  it('always sums to the total', () => {
    fc.assert(fc.property(
      fc.bigInt({ min: -(10n ** 20n), max: 10n ** 20n }),
      fc.array(fc.bigInt({ min: 0n, max: 1000n }), { minLength: 1, maxLength: 20 }).filter((r) => r.some((x) => x > 0n)),
      (total, ratios) => {
        const parts = money.allocate(total, ratios)
        expect(parts.reduce((a, b) => a + b, 0n)).toBe(total)
        expect(parts).toHaveLength(ratios.length)
      },
    ))
  })

  it('rejects ratios that cannot split anything', () => {
    expect(() => money.allocate(100n, [])).toThrow(RangeError)
    expect(() => money.allocate(100n, [0n, 0n])).toThrow(RangeError)
    expect(() => money.allocate(100n, [1n, -1n, 1n])).toThrow(RangeError)
    expect(() => money.allocate(100n, [0.5 as unknown as bigint])).toThrow(TypeError)
  })
})
