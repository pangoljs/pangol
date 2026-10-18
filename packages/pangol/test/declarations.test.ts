import { describe, expect, it } from 'vitest'
import { defineAuth, route, t } from '../src/index.js'

describe('schema declarations', () => {
  it('retains bounds and explicit object filtering metadata', () => {
    const schema = t.object({ title: t.string({ min: 1 }), tags: t.array(t.string()) })
    expect(schema.options.additionalProperties).toBe(false)
    expect(schema.options.properties).toEqual({
      title: t.string({ min: 1 }), tags: t.array(t.string()),
    })
    expect(t.string().options.max).toBe(10_000)
    expect(t.array(t.string()).options.max).toBe(1_000)
  })

  it('keeps modifiers independent of their original schema', () => {
    const original = t.int({ min: 1 })
    const optional = original.optional()
    const defaulted = optional.default(20)
    expect(original.options).toEqual({ min: 1 })
    expect(optional.options).toEqual({ min: 1, optional: true })
    expect(defaulted.options).toEqual({ min: 1, optional: false, default: 20 })
  })

  it('copies and freezes object shapes and enum values', () => {
    const shape = { name: t.string() }
    const values: [string, ...string[]] = ['draft', 'published']
    const object = t.object(shape)
    const choices = t.enum(values)
    shape.name = t.id()
    values[0] = 'changed'
    expect(object.options.properties).toEqual({ name: t.string() })
    expect(choices.options.values).toEqual(['draft', 'published'])
    expect(() => { (object.options.properties as typeof shape).name = t.id() }).toThrow()
    expect(() => { (choices.options.values as string[])[0] = 'changed' }).toThrow()
  })
})

describe('route declarations', () => {
  it('records a sync handler without invoking it or allocating a Promise', () => {
    let calls = 0
    const handler = () => { calls++; return 'ok' }
    const definition = route({ auth: 'public', response: t.string(), handler })
    expect(calls).toBe(0)
    expect(definition.handler).toBe(handler)
    expect(Object.isFrozen(definition)).toBe(true)
    expect(definition).not.toBeInstanceOf(Promise)
  })

  it('copies auth definitions without resolving requests', () => {
    let calls = 0
    const resolve = () => { calls++; return null }
    const definition = defineAuth({ from: { cookie: 'session' }, resolve })
    expect(calls).toBe(0)
    expect(definition.resolve).toBe(resolve)
    expect(Object.isFrozen(definition)).toBe(true)
    expect(Object.isFrozen(definition.from)).toBe(true)
  })

  it('rejects an auth definition the runtime could not use', () => {
    const resolve = () => null
    const invalid: unknown[] = [
      { resolve }, { from: 'header', resolve }, { from: { cookie: '' }, resolve },
      { from: { cookie: 'a b' }, resolve }, { from: { cookie: 'a;b' }, resolve }, { from: 'bearer' },
    ]
    for (const definition of invalid) {
      expect(() => defineAuth(definition as Parameters<typeof defineAuth>[0]), JSON.stringify(definition)).toThrow(TypeError)
    }
    expect(() => defineAuth({ from: { cookie: '__Host-session' }, resolve })).not.toThrow()
  })
})
