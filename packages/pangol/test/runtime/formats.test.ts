// t.money, t.email and t.uuid: declaration, input validation and response serialization.
import { describe, expect, it } from 'vitest'
import { t } from '../../src/index.js'
import { ValidationError, compileValidator } from '../../src/runtime/validate.js'
import { ResponseError, compileSerializer } from '../../src/runtime/serialize.js'

const fieldOf = (fn: () => unknown): string | undefined => {
  try { fn(); return undefined } catch (e) { if (e instanceof ValidationError) return e.field; throw e }
}
const pathOf = (fn: () => unknown): string | undefined => {
  try { fn(); return undefined } catch (e) { if (e instanceof ResponseError) return e.path; throw e }
}

describe('t.money declarations', () => {
  it('defaults to scale 2 and a minimum of zero, with bounds kept as minor units', () => {
    expect(t.money().options).toEqual({ scale: 2, min: 0n })
    expect(t.money({ currency: 'THB', min: '0.01', max: '50000' }).options).toEqual({ scale: 2, currency: 'THB', min: 1n, max: 5_000_000n })
    expect(t.money({ scale: 0, min: '-100' }).options).toEqual({ scale: 0, min: -100n })
    expect(t.money({ min: undefined }).options).toEqual({ scale: 2, min: 0n })
  })

  it('rejects options it cannot honour', () => {
    for (const scale of [-1, 1.5, 19]) expect(() => t.money({ scale }), String(scale)).toThrow(RangeError)
    for (const currency of ['thb', 'TH', 'THBB', '']) expect(() => t.money({ currency }), currency).toThrow(TypeError)
    expect(() => t.money({ min: '0.001' })).toThrow(RangeError) // finer than the scale
    expect(() => t.money({ min: 1 as unknown as string })).toThrow(TypeError) // a number bound would be a float
    expect(() => t.money({ min: '10', max: '1' })).toThrow(RangeError)
    expect(() => t.money({ max: '-1' })).toThrow(RangeError) // below the default minimum of zero
  })
})

describe('t.email and t.uuid declarations', () => {
  it('limit email length to 254 by default and never above it', () => {
    expect(t.email().options).toEqual({ max: 254 })
    expect(t.email({ max: 100 }).options).toEqual({ max: 100 })
    expect(t.email({ max: undefined }).options).toEqual({ max: 254 })
    expect(() => t.email({ max: 255 })).toThrow(RangeError)
    expect(() => t.email({ max: 1.5 })).toThrow(TypeError)
    expect(t.uuid().options).toEqual({})
  })
})

describe('money input', () => {
  const body = compileValidator(t.object({ amount: t.money({ max: '1000.00' }), fee: t.money().default(0n) }), 'body')
  const query = compileValidator(t.object({ min: t.money().optional() }), 'query')

  it('reads a decimal string into bigint minor units', () => {
    expect(body({ amount: '12.50' })).toEqual({ amount: 1250n, fee: 0n })
    expect(body({ amount: '12.5', fee: '0.07' })).toEqual({ amount: 1250n, fee: 7n })
    expect(body({ amount: '1000' })).toEqual({ amount: 100_000n, fee: 0n })
    expect(query({ min: '0.99' })).toEqual({ min: 99n })
  })

  it('refuses JSON numbers, extra decimals and non-canonical spellings', () => {
    for (const amount of [12.5, 12, 0, '12.505', '012.50', '+1.00', '-0.00', '1e3', ' 1.00', '.5', '', null, true, ['1.00'], 1250n]) {
      expect(fieldOf(() => body({ amount })), String(amount)).toBe('body.amount')
    }
    for (const min of ['1.001', 'abc', '']) expect(fieldOf(() => query({ min })), min).toBe('query.min')
  })

  it('enforces the bounds, including the default minimum of zero', () => {
    expect(fieldOf(() => body({ amount: '-0.01' }))).toBe('body.amount')
    expect(fieldOf(() => body({ amount: '1000.01' }))).toBe('body.amount')
    expect(body({ amount: '0.00' })).toEqual({ amount: 0n, fee: 0n })
    const refund = compileValidator(t.object({ delta: t.money({ min: '-50.00' }) }), 'body')
    expect(refund({ delta: '-50.00' })).toEqual({ delta: -5000n })
    expect(fieldOf(() => refund({ delta: '-50.01' }))).toBe('body.delta')
  })

  it('rejects a huge amount by length before parsing it', () => {
    const start = performance.now()
    expect(fieldOf(() => body({ amount: '9'.repeat(1_000_000) }))).toBe('body.amount')
    expect(performance.now() - start).toBeLessThan(50)
  })
})

describe('email and uuid input', () => {
  const body = compileValidator(t.object({ email: t.email(), id: t.uuid() }), 'body')
  const id = '0190a8f2-7c1e-7d3a-9b4e-1f2a3b4c5d6e'

  it('accepts what an HTML email input accepts, unchanged', () => {
    for (const email of ['ada@example.com', 'Ada.Lovelace+test@Example.CO.th', "o'brien@x.io", 'a@localhost']) {
      expect(body({ email, id }), email).toEqual({ email, id })
    }
  })

  it('rejects malformed or oversized email addresses', () => {
    const local64 = 'a'.repeat(64)
    expect(body({ email: `${local64}@x.io`, id })).toEqual({ email: `${local64}@x.io`, id })
    for (const email of ['', 'ada', '@x.io', 'ada@', 'a b@x.io', 'ada@x..io', 'ada@-x.io', 'ada@x-.io', 'ada@x.io.', '"a"@x.io', 'ada@[127.0.0.1]', 'a@b@c', 'ada@x.io\n', `${'a'.repeat(65)}@x.io`, `a@${'b'.repeat(64)}.io`, `a@${'b.'.repeat(126)}io`, 'ädä@x.io', 12]) {
      expect(fieldOf(() => body({ email, id })), String(email)).toBe('body.email')
    }
  })

  it('accepts only the canonical lowercase uuid form', () => {
    for (const bad of [id.toUpperCase(), `{${id}}`, id.replaceAll('-', ''), `urn:uuid:${id}`, id.slice(1), `${id}0`, id.replace('7', 'g'), '']) {
      expect(fieldOf(() => body({ email: 'a@x.io', id: bad })), bad).toBe('body.id')
    }
    expect(compileValidator(t.object({ id: t.uuid() }), 'params')({ id })).toEqual({ id })
  })
})

describe('response serialization of the new kinds', () => {
  const write = compileSerializer(t.object({ price: t.money(), rate: t.money({ scale: 4 }), email: t.email(), id: t.uuid() }))
  const value = { price: 1250n, rate: 70n, email: 'ada@x.io', id: '0190a8f2-7c1e-7d3a-9b4e-1f2a3b4c5d6e' }

  it('writes money as a decimal string with exactly `scale` decimals', () => {
    expect(write(value)).toBe('{"price":"12.50","rate":"0.0070","email":"ada@x.io","id":"0190a8f2-7c1e-7d3a-9b4e-1f2a3b4c5d6e"}')
    expect(JSON.parse(write({ ...value, price: -5n })).price).toBe('-0.05')
  })

  it('refuses money that is not a bigint, and non-string email or uuid', () => {
    for (const price of [12.5, 1250, '12.50']) expect(pathOf(() => write({ ...value, price })), String(price)).toBe('response.price')
    expect(pathOf(() => write({ ...value, email: 1 }))).toBe('response.email')
    expect(pathOf(() => write({ ...value, id: 1 }))).toBe('response.id')
  })
})
