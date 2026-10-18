import { describe, expect, it } from 'vitest'
import { version } from '../src/index.js'

const runtime = globalThis as typeof globalThis & {
  process: { env: Record<string, string | undefined> }
}

describe('pangol', () => {
  it('exports a version', () => {
    expect(version).toMatch(/^\d+\.\d+\.\d+/)
  })

  it.runIf(runtime.process.env['PANGOL_TEST_RUNTIME'] === 'bun')('runs test workers on Bun', () => {
    expect('Bun' in globalThis).toBe(true)
  })
})
