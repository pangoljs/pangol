import { describe, expect, it } from 'vitest'
import { t } from '../../src/index.js'
import { ValidationError, compileValidator } from '../../src/runtime/validate.js'

const fieldOf = (fn: () => unknown): string | undefined => {
  try { fn(); return undefined } catch (e) { if (e instanceof ValidationError) return e.field; throw e }
}

describe('body (JSON values, no coercion)', () => {
  const body = compileValidator(t.object({
    title: t.string({ min: 1, max: 5 }),
    count: t.int({ min: 0, max: 10 }),
    price: t.number(),
    published: t.bool(),
    status: t.enum(['draft', 'live']),
    tags: t.array(t.string({ max: 3 }), { max: 2 }),
    note: t.string().optional(),
    limit: t.int().default(20),
  }), 'body')
  const valid = { title: 'Hi', count: 1, price: 1.5, published: false, status: 'draft', tags: ['a'] }

  it('returns a new object with declared fields and applies defaults', () => {
    const out = body({ ...valid, role: 'admin', isAdmin: true })
    expect(out).toEqual({ ...valid, limit: 20 })
    expect(Object.hasOwn(out as object, 'note')).toBe(false)
  })

  it('names the failing field, with array indexes', () => {
    expect(fieldOf(() => body({ ...valid, title: '' }))).toBe('body.title')
    expect(fieldOf(() => body({ ...valid, title: 'toolong' }))).toBe('body.title')
    expect(fieldOf(() => body({ ...valid, count: 1.5 }))).toBe('body.count')
    expect(fieldOf(() => body({ ...valid, count: 11 }))).toBe('body.count')
    expect(fieldOf(() => body({ ...valid, count: '1' }))).toBe('body.count') // no coercion in JSON
    expect(fieldOf(() => body({ ...valid, published: 'false' }))).toBe('body.published')
    expect(fieldOf(() => body({ ...valid, status: 'deleted' }))).toBe('body.status')
    expect(fieldOf(() => body({ ...valid, tags: ['a', 'b', 'c'] }))).toBe('body.tags')
    expect(fieldOf(() => body({ ...valid, tags: ['a', 'long'] }))).toBe('body.tags[1]')
    expect(fieldOf(() => body({ ...valid, title: undefined }))).toBe('body.title')
    expect(fieldOf(() => body({ ...valid, note: null }))).toBe('body.note') // null is a value, not "missing"
    expect(fieldOf(() => body([valid]))).toBe('body')
    expect(fieldOf(() => body(null))).toBe('body')
  })

  it('reads only own properties', () => {
    const inherited = Object.assign(Object.create({ title: 'Hi' }), { ...valid, title: undefined })
    expect(fieldOf(() => body(inherited))).toBe('body.title')
  })

  it('checks string length before the pattern (ReDoS)', () => {
    // a catastrophic pattern: running it on this input would take far longer than the limit below
    const v = compileValidator(t.object({ s: t.string({ max: 3, pattern: /^(a+)+$/ }) }), 'body')
    const start = performance.now()
    expect(fieldOf(() => v({ s: 'a'.repeat(50_000) + '!' }))).toBe('body.s')
    expect(performance.now() - start).toBeLessThan(50)
  })

  it('validates ids as safe path segments', () => {
    const v = compileValidator(t.object({ id: t.id() }), 'body')
    for (const id of ['', '../x', 'a/b', 'a\u0000', 'x'.repeat(201)]) expect(fieldOf(() => v({ id })), JSON.stringify(id)).toBe('body.id')
    expect(v({ id: 'p_1' })).toEqual({ id: 'p_1' })
  })
})

describe('params and query (strings, coerced strictly)', () => {
  const query = compileValidator(t.object({
    page: t.int({ min: 1 }).default(1), ratio: t.number().optional(), active: t.bool().optional(), q: t.string().optional(),
  }), 'query')

  it('coerces canonical spellings only', () => {
    expect(query({ page: '2', ratio: '-0.5', active: 'true', q: '' })).toEqual({ page: 2, ratio: -0.5, active: true, q: '' })
    for (const page of ['01', '+1', '1.0', '1e3', ' 1', '0x10', '', '9007199254740993']) {
      expect(fieldOf(() => query({ page })), page).toBe('query.page')
    }
    for (const active of ['1', 'yes', 'TRUE', '']) expect(fieldOf(() => query({ active })), active).toBe('query.active')
    for (const ratio of ['.5', '5.', '1e2', 'NaN', 'Infinity']) expect(fieldOf(() => query({ ratio })), ratio).toBe('query.ratio')
  })

  it('applies defaults when the key is absent', () => {
    expect(query({})).toEqual({ page: 1 })
  })

  it('refuses nested schemas at compile time: a URL value is a single string', () => {
    expect(() => compileValidator(t.object({ tags: t.array(t.string()) }), 'query')).toThrow(TypeError)
    expect(() => compileValidator(t.object({ a: t.object({}) }), 'params')).toThrow(TypeError)
  })
})

describe('compile-time checks', () => {
  it('requires an object schema at the top', () => {
    expect(() => compileValidator(t.string(), 'body')).toThrow(TypeError)
  })
  it('refuses field names that would write to the prototype', () => {
    expect(() => compileValidator(t.object({ ['__proto__']: t.string() }), 'body')).toThrow(TypeError)
  })
})
