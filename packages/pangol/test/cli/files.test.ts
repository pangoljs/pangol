import { describe, expect, it } from 'vitest'
import { routeFromFile } from '../../src/cli/files.js'

describe('route file names (SPEC section 4)', () => {
  it('maps <name>.<method>.ts to a method and path', () => {
    for (const [file, key] of [
      ['health.get.ts', 'GET /health'],
      ['index.get.ts', 'GET /'],
      ['posts/index.get.ts', 'GET /posts'],
      ['posts/index.post.ts', 'POST /posts'],
      ['posts/[id].patch.ts', 'PATCH /posts/:id'],
      ['posts/[id].delete.js', 'DELETE /posts/:id'],
      ['posts/[postId]/comments/[id].put.ts', 'PUT /posts/:postId/comments/:id'],
      ['posts/search.get.ts', 'GET /posts/search'],
      ['v2/user-settings.get.mts', 'GET /v2/user-settings'],
    ]) {
      expect(routeFromFile(file as string), file).toEqual({ kind: 'route', key })
    }
  })

  it('skips files and folders that start with _, and type declarations', () => {
    for (const file of ['_guards.ts', 'posts/_helpers.ts', '_lib/index.get.ts', 'posts/index.d.ts']) {
      expect(routeFromFile(file), file).toEqual({ kind: 'skip' })
    }
  })

  it('refuses any other name, with a fix', () => {
    for (const file of [
      'health.ts', 'health.GET.ts', 'health.head.ts', 'health.get.test.ts', 'health.get.json', 'README.md',
      'posts/[id.get.ts', 'posts/[1d].get.ts', 'posts/[id]x.get.ts', 'posts/[id]/[id].get.ts',
      '.hidden.get.ts', 'posts/a b.get.ts', 'posts/%2e.get.ts', 'posts/../x.get.ts', '[...rest].get.ts', 'index/.get.ts',
    ]) {
      const r = routeFromFile(file)
      expect(r.kind, file).toBe('error')
      if (r.kind === 'error') expect(r.fix.length, file).toBeGreaterThan(0)
    }
  })
})
