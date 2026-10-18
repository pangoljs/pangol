// Runs on Bun only (pnpm test:bun); on Node it checks the adapter refuses to start.
import { describe, expect, it } from 'vitest'
import { createApp, route, t } from '../src/index.js'
import { serve } from '../src/bun.js'

const onBun = 'Bun' in globalThis
const app = createApp({
  routes: {
    'GET /ip': route({ auth: 'public', response: t.object({ ip: t.string() }), handler: (c) => ({ ip: c.ip }) }),
    'POST /echo': route({ auth: 'public', body: t.object({ n: t.int() }), response: t.int(), handler: (c) => c.body.n }),
  },
})

describe.runIf(onBun)('Bun.serve adapter', () => {
  it('serves the app over HTTP with the client address', async () => {
    const server = serve(app, { port: 0, hostname: '127.0.0.1' })
    try {
      const res = await fetch(new URL('/ip', server.url))
      expect(res.status).toBe(200)
      expect(res.headers.get('x-content-type-options')).toBe('nosniff')
      expect(((await res.json()) as { ip: string }).ip).toMatch(/127\.0\.0\.1/)
      const echo = await fetch(new URL('/echo', server.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n":7}' })
      expect(await echo.json()).toBe(7)
      const big = await fetch(new URL('/echo', server.url), { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(2 * 1024 * 1024) })
      expect(big.status).toBe(413)
    } finally {
      await server.stop(true)
    }
  })
})

it.runIf(!onBun)('refuses to start outside Bun', () => {
  expect(() => serve(app)).toThrow(/needs the Bun runtime/)
})
