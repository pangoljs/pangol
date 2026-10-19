import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { analyze } from '../../src/cli/analyze.js'

// Functions are passed as real functions: the checker reads their source the same way at run time.
const reads = (fn: (...args: never[]) => unknown) => {
  const a = analyze(ts, fn)
  return { reads: [...a.reads].sort(), escapes: a.escapes, failStatuses: [...a.failStatuses] }
}
declare const db: { get(id: unknown): unknown; save(...v: unknown[]): unknown }
type C = Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any

describe('what a handler reads from its context', () => {
  it('follows property access whatever the parameter is called', () => {
    expect(reads((c: C) => db.get(c.params.id))).toEqual({ reads: ['params'], escapes: false, failStatuses: [] })
    expect(reads((ctx: C) => ({ id: ctx.resource.id, by: ctx.user.id }))).toMatchObject({ reads: ['resource', 'user'] })
    expect(reads(async function (x: C) { await db.save(x.body); return x.noContent() })).toMatchObject({ reads: ['body', 'noContent'] })
  })

  it('follows destructuring, in the parameter and in the body, and aliases', () => {
    expect(reads(({ user, body: b }: C) => db.save(user, b))).toMatchObject({ reads: ['body', 'user'], escapes: false })
    expect(reads((c: C) => { const { query } = c; return query })).toMatchObject({ reads: ['query'], escapes: false })
    expect(reads((c: C) => { const ctx = c; return ctx.user })).toMatchObject({ reads: ['user'], escapes: false })
    expect(reads((c: C) => c['resource'])).toMatchObject({ reads: ['resource'], escapes: false })
  })

  it('reads in nested functions count', () => {
    expect(reads((c: C) => [1].map(() => c.user.id))).toMatchObject({ reads: ['user'], escapes: false })
  })

  it('marks the context as escaping when it cannot follow it', () => {
    for (const fn of [
      (c: C) => db.save(c),
      (c: C) => c[String('user')],
      ({ ...rest }: C) => rest,
      (c: C) => { const { ...all } = c; return all },
      (...args: C[]) => args[0],
      (c: C) => { let x; x = c; return x },
      (c: C) => ({ c }),
    ]) {
      expect(reads(fn).escapes, fn.toString()).toBe(true)
    }
  })

  it('records the literal statuses passed to fail()', () => {
    expect(reads((c: C) => c.fail(403, 'no'))).toMatchObject({ reads: ['fail'], failStatuses: [403] })
    expect(reads(({ fail }: C) => fail(409, 'x'))).toMatchObject({ failStatuses: [409] })
    expect(reads((c: C) => c.fail(Number('403'), 'x'))).toMatchObject({ failStatuses: ['unknown'] })
  })

  it('reads method shorthand and named functions declared elsewhere', () => {
    const route = { handler(c: C) { return c.resource } }
    expect(reads(route.handler)).toMatchObject({ reads: ['resource'] })
    function update(c: C) { return db.save(c.params.id, c.body) }
    expect(reads(update)).toMatchObject({ reads: ['body', 'params'] })
  })

  it('a handler without a parameter reads nothing', () => {
    expect(reads(() => 'ok')).toEqual({ reads: [], escapes: false, failStatuses: [] })
  })
})
