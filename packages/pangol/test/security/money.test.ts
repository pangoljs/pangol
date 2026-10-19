// AGENTS.md rule 4: money never travels as a floating point number, in either direction.
import { describe, expect, it } from 'vitest'
import { createApp, defineAuth, money, route, t } from '../../src/index.js'

const ada = { id: 'ada', permissions: [] }
const auth = defineAuth({ from: 'bearer', resolve: () => ada })
const post = (app: { fetch(r: Request): Promise<Response> }, path: string, body: string) =>
  app.fetch(new Request('http://api.test' + path, {
    method: 'POST', headers: { authorization: 'Bearer x', 'content-type': 'application/json' }, body,
  }))

describe('money through the pipeline', () => {
  const logs: string[] = []
  let received: unknown
  const app = createApp({
    auth,
    log: (m) => logs.push(m),
    routes: {
      'POST /transfers': route({
        auth: 'user',
        body: t.object({ amount: t.money({ min: '0.01' }) }),
        response: t.object({ amount: t.money(), fee: t.money() }),
        handler: (c) => {
          received = c.body.amount
          return { amount: c.body.amount, fee: money.mul(c.body.amount, '0.015', 'halfEven') }
        },
      }),
      'POST /float': route({ auth: 'user', response: t.object({ total: t.money() }), handler: () => ({ total: 0.1 + 0.2 }) as never }),
    },
  })

  it('a decimal string reaches the handler as bigint minor units and goes back as a string', async () => {
    const res = await post(app, '/transfers', '{"amount":"100.10"}')
    expect(res.status).toBe(200)
    expect(received).toBe(10010n)
    expect(await res.text()).toBe('{"amount":"100.10","fee":"1.50"}')
  })

  it('a JSON number amount is a 400, even a whole one', async () => {
    for (const amount of ['100.1', '100', '1e2']) {
      expect((await post(app, '/transfers', `{"amount":${amount}}`)).status, amount).toBe(400)
    }
  })

  it('negative and zero amounts are refused when min says so', async () => {
    for (const amount of ['"-100.00"', '"0.00"', '"0"']) expect((await post(app, '/transfers', `{"amount":${amount}}`)).status, amount).toBe(400)
  })

  it('a handler that returns a float for money gets a 500, not a rounded number', async () => {
    const res = await post(app, '/float', '')
    expect(res.status).toBe(500)
    expect(await res.text()).not.toContain('0.3')
    expect(logs.join('\n')).toContain('response.total')
  })
})

it('money defaults to non-negative: a negative amount must be declared', () => {
  // the "transfer -100 to steal 100" bug: without an explicit min, negatives never validate
  const v = t.money()
  expect(v.options.min).toBe(0n)
  expect(t.money({ min: '-1.00' }).options.min).toBe(-100n)
})
