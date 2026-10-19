import { describe, expect, it } from 'vitest'
import { t } from '../../src/index.js'
import { ResponseError, compileSerializer } from '../../src/runtime/serialize.js'

const pathOf = (fn: () => unknown): string | undefined => {
  try { fn(); return undefined } catch (e) { if (e instanceof ResponseError) return e.path; throw e }
}

describe('response serializer', () => {
  const post = compileSerializer(t.object({
    id: t.id(), title: t.string(), views: t.int(), score: t.number(), published: t.bool(),
    status: t.enum(['draft', 'live']), tags: t.array(t.string()), note: t.string().optional(),
    author: t.object({ name: t.string() }),
  }))
  const value = { id: 'p1', title: 'Hi "there"', views: 3, score: 0.5, published: true, status: 'live', tags: ['a', 'b'], author: { name: 'Ada' } }

  it('produces the same JSON as JSON.stringify for declared fields', () => {
    expect(JSON.parse(post(value))).toEqual(value)
    expect(post(value)).toBe(JSON.stringify(value))
  })

  it('omits a missing or null optional field', () => {
    expect(JSON.parse(post({ ...value, note: null }))).toEqual(value)
    expect(JSON.parse(post({ ...value, note: 'n' }))).toEqual({ ...value, note: 'n' })
  })

  it('reads fields from class instances and getters, ignoring toJSON', () => {
    class Author { get name() { return 'Ada' } toJSON() { return { name: 'hacked', secret: 1 } } }
    expect(JSON.parse(post({ ...value, author: new Author() })).author).toEqual({ name: 'Ada' })
  })

  it('fails instead of coercing a value that does not match the schema', () => {
    expect(pathOf(() => post({ ...value, title: undefined }))).toBe('response.title')
    expect(pathOf(() => post({ ...value, title: 42 }))).toBe('response.title')
    expect(pathOf(() => post({ ...value, views: 1.5 }))).toBe('response.views')
    expect(pathOf(() => post({ ...value, score: Number.NaN }))).toBe('response.score')
    expect(pathOf(() => post({ ...value, published: 'yes' }))).toBe('response.published')
    expect(pathOf(() => post({ ...value, status: 'deleted' }))).toBe('response.status')
    expect(pathOf(() => post({ ...value, tags: ['a', 1] }))).toBe('response.tags[1]')
    expect(pathOf(() => post({ ...value, author: null }))).toBe('response.author')
    expect(pathOf(() => post([value]))).toBe('response')
    expect(pathOf(() => post(undefined))).toBe('response')
  })

  it('serializes top-level arrays and primitives', () => {
    expect(compileSerializer(t.array(t.object({ id: t.id() })))([{ id: 'a', secret: 1 }])).toBe('[{"id":"a"}]')
    expect(compileSerializer(t.string())('x')).toBe('"x"')
  })
})
