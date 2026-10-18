import { describe, expect, it } from 'vitest'
import { t } from '../../src/index.js'

// Callers without exactOptionalPropertyTypes (most user projects) can pass `max: undefined`.
describe('schema bounds cannot be removed by an undefined option', () => {
  it('keeps the default string and array limits when max is undefined', () => {
    expect(t.string({ max: undefined }).options.max).toBe(10_000)
    expect(t.array(t.string(), { max: undefined }).options.max).toBe(1_000)
  })

  it('rejects limits that are not finite, non-negative integers', () => {
    for (const max of [Infinity, -1, 1.5, Number.NaN]) {
      expect(() => t.string({ max })).toThrow(TypeError)
      expect(() => t.array(t.string(), { max })).toThrow(TypeError)
    }
    expect(() => t.int({ min: 1.5 })).toThrow(TypeError)
    expect(() => t.number({ max: Infinity })).toThrow(TypeError)
  })

  it('rejects min greater than max', () => {
    expect(() => t.string({ min: 5, max: 1 })).toThrow(RangeError)
    expect(() => t.int({ min: 10, max: 1 })).toThrow(RangeError)
  })

  it('accepts valid bounds unchanged', () => {
    expect(t.string({ min: 1, max: 50 }).options).toEqual({ min: 1, max: 50 })
    expect(t.array(t.int(), { min: 0, max: 5 }).options).toMatchObject({ min: 0, max: 5 })
    expect(t.int({ min: -3, max: 3 }).options).toEqual({ min: -3, max: 3 })
    expect(t.number({ min: -0.5 }).options).toEqual({ min: -0.5 })
  })
})

describe('string patterns cannot keep state between requests', () => {
  it('rejects global and sticky regular expressions', () => {
    expect(() => t.string({ pattern: /a/g })).toThrow(TypeError)
    expect(() => t.string({ pattern: /a/y })).toThrow(TypeError)
  })

  it('accepts stateless patterns and gives the same answer on every call', () => {
    const pattern = t.string({ pattern: /^a+$/i }).options.pattern as RegExp
    expect([pattern.test('aA'), pattern.test('aA'), pattern.test('b')]).toEqual([true, true, false])
  })
})

describe('defaults cannot be shared mutable state', () => {
  it('freezes array and nested object defaults', () => {
    const tags = t.array(t.string()).default([]).options.default as string[]
    expect(() => tags.push('poisoned')).toThrow(TypeError)
    const shape = t.object({ meta: t.object({ n: t.int() }) })
    const meta = shape.default({ meta: { n: 1 } }).options.default as { meta: { n: number } }
    expect(() => { meta.meta.n = 2 }).toThrow(TypeError)
  })

  it('copies the default so later changes to the original value do not leak in', () => {
    const original = ['draft']
    const schema = t.array(t.string()).default(original)
    original.push('changed')
    expect(schema.options.default).toEqual(['draft'])
  })

  it('keeps primitive defaults as they are', () => {
    expect(t.int().default(20).options.default).toBe(20)
    expect(t.string().default('x').options.default).toBe('x')
  })
})
