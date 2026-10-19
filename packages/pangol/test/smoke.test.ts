/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { version } from '../src/index.js'

const runtime = globalThis as typeof globalThis & {
  process: { env: Record<string, string | undefined> }
}

describe('pangol', () => {
  it('exports the version in package.json', () => {
    expect(version).toBe(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version)
  })

  it.runIf(runtime.process.env['PANGOL_TEST_RUNTIME'] === 'bun')('runs test workers on Bun', () => {
    expect('Bun' in globalThis).toBe(true)
  })
})
