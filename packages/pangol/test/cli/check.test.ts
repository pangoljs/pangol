import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { check, formatFindings } from '../../src/cli/check.js'

const fixture = (name: string) => fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url))
const run = (name: string) => check({ root: fixture(name), ts })

describe('pangol check', () => {
  it('a clean project has no findings and lists every route with its file', async () => {
    const result = await run('good')
    expect(result.findings).toEqual([])
    expect(result.routes.map((r) => [r.key, r.file])).toEqual([
      ['GET /health', 'src/routes/health.get.ts'],
      ['PATCH /posts/:id', 'src/routes/posts/[id].patch.ts'],
      ['POST /posts/:id/publish', 'src/routes/posts/[id]/publish.post.ts'],
      ['GET /posts', 'src/routes/posts/index.get.ts'],
    ])
    expect(result.auth).toBeDefined()
  })

  it('reports every rule against the file that breaks it', async () => {
    const { findings } = await run('bad')
    const seen = findings.map((f) => `${f.rule ?? '-'} ${f.file}`)
    expect(seen.sort()).toEqual([
      'C10 src/routes/secret.get.ts',
      'C13 src/routes/logout.post.ts',
      'C14 src/routes/dup/index.get.ts',
      'C14 src/routes/nodefault.get.ts',
      'C14 src/routes/notes.ts',
      'C14 src/routes/throws.get.ts',
      'C3 src/routes/search.post.ts',
      'C6 src/routes/posts/[id].delete.ts',
      'C7 src/routes/posts/[id].get.ts',
      'C8 src/routes/posts/[id].put.ts',
      'C9 src/routes/feed.get.ts',
    ])
    const of = (file: string) => findings.find((f) => f.file === `src/routes/${file}`)
    expect(of('dup/index.get.ts')?.what).toContain('src/routes/dup.get.ts')
    expect(of('throws.get.ts')?.what).toContain('cannot connect to the database')
    expect(of('feed.get.ts')?.fix).toContain("'optional'")
    expect(of('posts/[id].get.ts')?.what).toContain('c.resource')
    for (const f of findings) expect(f.fix.length, f.what).toBeGreaterThan(0)
  })

  it('routes that are not public need src/auth.ts', async () => {
    const { findings } = await run('noauth')
    expect(findings).toHaveLength(1)
    expect(findings[0]).toMatchObject({ rule: 'C14', file: 'src/routes/posts/index.post.ts' })
    expect(findings[0]?.fix).toContain('src/auth.ts')
  })

  it('a missing routes folder is a finding, not a crash', async () => {
    const { findings } = await check({ root: fixture('good'), routes: 'src/nope', ts })
    expect(findings).toEqual([expect.objectContaining({ file: 'src/nope' })])
  })

  it('prints findings grouped by file, as SPEC section 9 shows', async () => {
    const text = formatFindings((await run('bad')).findings)
    expect(text).toContain('✖ src/routes/posts/[id].delete.ts\n  DELETE /posts/:id ')
    expect(text).toMatch(/\n {4}Fix: /)
  })
})
