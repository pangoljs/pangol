// SPEC section 6 and check C10: a .private() field can never be part of a response. The type error
// is in route.types.ts; this is the startup check for JavaScript callers and casts.
import { describe, expect, it } from 'vitest'
import { createApp, route, t } from '../../src/index.js'
import { compileSerializer } from '../../src/runtime/serialize.js'
import { compileValidator } from '../../src/runtime/validate.js'

const User = t.model({ id: t.id(), name: t.string(), passwordHash: t.string().private() })
const ada = { id: 'u1', name: 'Ada', passwordHash: '$argon2id$secret' }

describe('a private field in a response stops the app from starting', () => {
  const start = (response: unknown) => () => createApp({
    routes: { 'GET /me': route({ auth: 'public', response: response as never, handler: () => ada as never }) },
  })

  it('directly, picked, nested, in an array, or optional', () => {
    for (const [response, path] of [
      [User, 'response.passwordHash'],
      [User.pick('passwordHash'), 'response.passwordHash'],
      [t.object({ user: User }), 'response.user.passwordHash'],
      [t.array(User), 'response[].passwordHash'],
      [t.object({ token: t.string().private().optional() }), 'response.token'],
      [t.string().private(), 'response'],
    ] as const) {
      expect(start(response), path).toThrow(path)
    }
    expect(() => compileSerializer(User)).toThrow(/private/)
  })

  it('the public view starts and never sends the private field', async () => {
    const app = createApp({ routes: { 'GET /me': route({ auth: 'public', response: User.public(), handler: () => ada }) } })
    const body = await (await app.fetch(new Request('http://api.test/me'))).text()
    expect(body).toBe('{"id":"u1","name":"Ada"}')
    expect(body).not.toContain('argon2')
  })

  it('private fields can still be read as input', () => {
    expect(compileValidator(User.pick('name', 'passwordHash'), 'body')({ name: 'Ada', passwordHash: 'h' })).toEqual({ name: 'Ada', passwordHash: 'h' })
  })
})
