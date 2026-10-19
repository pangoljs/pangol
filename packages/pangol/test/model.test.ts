import { describe, expect, it } from 'vitest'
import { Schema, t } from '../src/index.js'
import { ValidationError, compileValidator } from '../src/runtime/validate.js'
import { compileSerializer } from '../src/runtime/serialize.js'

const User = t.model({
  id: t.id(),
  name: t.string({ min: 1, max: 100 }),
  email: t.email(),
  role: t.enum(['admin', 'member']).default('member'),
  passwordHash: t.string().private(),
})
const keys = (s: Schema<unknown, boolean>) => Object.keys(s.options['properties'] as object)

describe('t.model', () => {
  it('is an object schema that drops undeclared keys', () => {
    expect(User).toBeInstanceOf(Schema)
    expect(User.kind).toBe('object')
    expect(User.options['additionalProperties']).toBe(false)
    expect(keys(User)).toEqual(['id', 'name', 'email', 'role', 'passwordHash'])
    expect(Object.isFrozen(User)).toBe(true)
    expect(Object.isFrozen(User.options['properties'])).toBe(true)
  })

  it('marks .private() fields without changing anything else', () => {
    expect(t.string().private().options).toEqual({ max: 10_000, private: true })
    expect(t.string().private().optional().options).toEqual({ max: 10_000, private: true, optional: true })
    expect(t.string().options).toEqual({ max: 10_000 })
  })

  it('public() keeps every field that is not private', () => {
    expect(keys(User.public())).toEqual(['id', 'name', 'email', 'role'])
  })

  it('public() also leaves out fields that contain a private field, at any depth', () => {
    const Team = t.model({ id: t.id(), lead: User, members: t.array(User), profile: t.object({ bio: t.string() }), tags: t.array(t.string()) })
    expect(keys(Team.public())).toEqual(['id', 'profile', 'tags'])
  })

  it('pick() and omit() keep the order of the model and return models', () => {
    expect(keys(User.pick('email', 'name'))).toEqual(['name', 'email'])
    expect(keys(User.omit('passwordHash', 'role'))).toEqual(['id', 'name', 'email'])
    expect(keys(User.pick('name', 'email').omit('email'))).toEqual(['name'])
    expect(User.pick('name').options['properties']).toEqual({ name: t.string({ min: 1, max: 100 }) })
  })

  it('refuses keys the model does not have (for callers without types)', () => {
    expect(() => User.pick('nmae' as 'name')).toThrow(/nmae/)
    expect(() => User.omit('passwrodHash' as 'name')).toThrow(/passwrodHash/)
    expect(() => (User.pick as (...keys: string[]) => unknown).call(User)).toThrow(/at least one field/)
  })

  it('partial() makes every field optional and drops defaults, as a PATCH body needs', () => {
    const patch = compileValidator(User.pick('name', 'role').partial(), 'body')
    expect(patch({})).toEqual({}) // no default role: an absent field means "leave it as it is"
    expect(patch({ role: 'admin' })).toEqual({ role: 'admin' })
    expect(() => patch({ name: '' })).toThrow(ValidationError) // bounds still apply
    const create = compileValidator(User.pick('name', 'email', 'role'), 'body')
    expect(create({ name: 'Ada', email: 'ada@x.io' })).toEqual({ name: 'Ada', email: 'ada@x.io', role: 'member' })
  })

  it('a model can be used as a field and inside an array', () => {
    const write = compileSerializer(t.object({ items: t.array(User.public()), owner: User.pick('name') }))
    const ada = { id: 'u1', name: 'Ada', email: 'ada@x.io', role: 'admin', passwordHash: 'h' }
    expect(write({ items: [ada], owner: ada })).toBe('{"items":[{"id":"u1","name":"Ada","email":"ada@x.io","role":"admin"}],"owner":{"name":"Ada"}}')
  })

  it('refuses a field named __proto__', () => {
    expect(() => t.model({ ['__proto__']: t.string() })).toThrow(TypeError)
  })
})
