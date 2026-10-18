// Input and output filtering: the two guarantees in SPEC section 1 (goal 2) and section 6.
import { expect, it } from 'vitest'
import { t } from '../../src/index.js'
import { compileValidator } from '../../src/runtime/validate.js'
import { compileSerializer } from '../../src/runtime/serialize.js'

const User = t.object({ id: t.id(), name: t.string(), email: t.string() })

it('undeclared response fields never reach the client, at any depth', () => {
  const list = compileSerializer(t.object({ items: t.array(User) }))
  const row = { id: 'u1', name: 'Ada', email: 'a@x.io', passwordHash: 'h', token: 't', nested: { secret: 1 } }
  const json = list({ items: [row], total: 1, debug: { sql: 'select *' } })
  expect(JSON.parse(json)).toEqual({ items: [{ id: 'u1', name: 'Ada', email: 'a@x.io' }] })
  for (const leaked of ['passwordHash', 'token', 'secret', 'total', 'sql']) expect(json).not.toContain(leaked)
})

it('mass assignment: undeclared input fields are dropped, at any depth', () => {
  const body = compileValidator(t.object({ name: t.string(), profile: t.object({ bio: t.string() }) }), 'body')
  const out = body({ name: 'Ada', role: 'admin', isAdmin: true, profile: { bio: 'b', verified: true } })
  expect(out).toEqual({ name: 'Ada', profile: { bio: 'b' } })
})

it('declared-only output is a safe case too: a value with exactly the declared fields is unchanged', () => {
  const row = { id: 'u1', name: 'Ada', email: 'a@x.io' }
  expect(JSON.parse(compileSerializer(User)(row))).toEqual(row)
})
