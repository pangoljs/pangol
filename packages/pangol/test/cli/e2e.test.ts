/// <reference types="node" />
// The `pangol` binary on a real project: pangol built into node_modules, routes in TypeScript that
// import 'pangol' and each other with ".js" specifiers, run by this runtime (node, or bun in test:bun).
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const pkg = fileURLToPath(new URL('../..', import.meta.url))
let project = ''
const bin = () => join(project, 'node_modules/pangol/dist/cli/main.js')
const pangol = (...args: string[]) => {
  const r = spawnSync(process.execPath, [bin(), ...args], { cwd: project, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } })
  return { code: r.status, out: r.stdout, err: r.stderr }
}
const write = (file: string, text: string) => {
  mkdirSync(dirname(join(project, file)), { recursive: true })
  writeFileSync(join(project, file), text)
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), 'pangol-cli-'))
  const installed = join(project, 'node_modules/pangol')
  mkdirSync(installed, { recursive: true })
  cpSync(join(pkg, 'package.json'), join(installed, 'package.json'))
  execFileSync(process.execPath, [join(pkg, 'node_modules/typescript/bin/tsc'), '-p', join(pkg, 'tsconfig.build.json'), '--outDir', join(installed, 'dist')])
  symlinkSync(join(pkg, 'node_modules/typescript'), join(project, 'node_modules/typescript'), 'dir')
  write('package.json', '{ "type": "module" }')
  write('tsconfig.json', '{ "compilerOptions": { "module": "NodeNext", "strict": true } }')
  write('src/auth.ts', `import { defineAuth } from 'pangol'
export default defineAuth({ from: 'bearer', resolve: () => ({ id: 'ada', permissions: [] }) })
`)
  write('src/models.ts', `import { t } from 'pangol'
export const Post = t.model({ id: t.id(), title: t.string(), authorId: t.id() })
`)
  write('src/routes/health.get.ts', `import { route, t } from 'pangol'
export default route({ auth: 'public', response: t.object({ ok: t.bool() }), handler: () => ({ ok: true }) })
`)
  write('src/routes/posts/[id].get.ts', `import { route, t } from 'pangol'
import { Post } from '../../models.js'
const rows = new Map([['p1', { id: 'p1', title: 'Hi', authorId: 'ada' }]])
export default route({
  auth: 'user',
  params: t.object({ id: t.id() }),
  load: (c) => rows.get(c.params.id),
  owner: (c, post) => post.authorId === c.user.id,
  response: Post.public(),
  handler: (c) => c.resource,
})
`)
}, 60_000)
afterAll(() => { if (project !== '') rmSync(project, { recursive: true, force: true }) })

describe('pangol binary', () => {
  it('check passes on a clean project', () => {
    const r = pangol('check')
    expect(r.err).toBe('')
    expect(r.out).toContain('2 route(s) checked, no problems')
    expect(r.code).toBe(0)
  })

  it('routes lists each route with its auth and owner', () => {
    const r = pangol('routes')
    expect(r.code).toBe(0)
    expect(r.out.split('\n').map((l) => l.trim().split(/\s+/))).toEqual([
      ['ROUTE', 'AUTH', 'OWNER', 'FILE'],
      ['GET', '/health', 'public', '-', 'src/routes/health.get.ts'],
      ['GET', '/posts/:id', 'user', 'function', 'src/routes/posts/[id].get.ts'],
      [''],
    ])
  })

  it('build writes a static route table that createApp accepts', async () => {
    expect(pangol('build').code).toBe(0)
    const generated = readFileSync(join(project, '.pangol/routes.ts'), 'utf8')
    expect(generated).toContain(`import r0 from "../src/routes/health.get.js"`)
    expect(generated).toContain(`"GET /posts/:id": r1,`)
    // the generated table works: run a tiny server script through this runtime
    write('src/server.ts', `import { createApp } from 'pangol'
import auth from './auth.js'
import { routes } from '../.pangol/routes.js'
const app = createApp({ auth, routes })
const res = await app.fetch(new Request('http://x/posts/p1', { headers: { authorization: 'Bearer t' } }))
console.log(res.status, await res.text())
`)
    // Node needs the same .js -> .ts resolve hook the CLI uses (pangol/register); Bun resolves it by itself
    const preload = 'Bun' in globalThis ? [] : ['--import', 'pangol/register']
    const run = spawnSync(process.execPath, [...preload, join(project, 'src/server.ts')], { cwd: project, encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } })
    expect(run.stdout.trim(), run.stderr).toBe('200 {"id":"p1","title":"Hi","authorId":"ada"}')
  })

  it('fails with exit 1 and a fix when a rule is broken', () => {
    write('src/routes/posts/[id].delete.ts', `import { route, t } from 'pangol'
export default route({ auth: 'user', params: t.object({ id: t.id() }), response: t.empty(), handler: (c) => c.noContent() })
`)
    const r = pangol('check')
    rmSync(join(project, 'src/routes/posts/[id].delete.ts'))
    expect(r.code).toBe(1)
    expect(r.err).toContain('✖ src/routes/posts/[id].delete.ts')
    expect(r.err).toContain('Fix: add load:')
  })

  it('check --manifest writes the security manifest', () => {
    expect(pangol('check', '--manifest', 'manifest.json').code).toBe(0)
    const manifest = JSON.parse(readFileSync(join(project, 'manifest.json'), 'utf8'))
    expect(Object.keys(manifest.routes)).toEqual(['GET /health', 'GET /posts/:id'])
    expect(manifest.routes['GET /posts/:id'].imports).toEqual({ 'src/models.ts': expect.any(String) })
  })

  it('diff against a git revision rebuilds the base from git, never from a committed manifest', () => {
    const g = (...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: project, stdio: 'pipe' })
    write('.gitignore', 'node_modules\n.pangol\n')
    g('init', '-q', '-b', 'main')
    g('add', '-A')
    g('commit', '-q', '-m', 'base')
    expect(pangol('diff', 'main').out).toContain('No security-relevant changes.')
    // the head drops the owner rule
    write('src/routes/posts/[id].get.ts', readFileSync(join(project, 'src/routes/posts/[id].get.ts'), 'utf8')
      .replace("  owner: (c, post) => post.authorId === c.user.id,\n", "  owner: 'none',\n"))
    const r = pangol('diff', 'main', '--format', 'markdown', '--fail-on', 'high', '--json', 'diff.json')
    expect(r.code).toBe(1)
    expect(r.out).toContain("- **GET /posts/:id**: owner became 'none' (was a function)")
    expect(JSON.parse(readFileSync(join(project, 'diff.json'), 'utf8'))[0]).toMatchObject({ level: 'high', route: 'GET /posts/:id' })
    g('commit', '-q', '-am', 'head')
    expect(pangol('diff', 'main~1..main', '--fail-on', 'high').code).toBe(1)
    expect(pangol('diff', 'main~1..main').code).toBe(0) // no --fail-on: report only
    expect(pangol('diff', 'nope').code).toBe(2)
    expect(execFileSync('git', ['worktree', 'list'], { cwd: project, encoding: 'utf8' }).trim().split('\n')).toHaveLength(1) // cleaned up
  })

  it('openapi prints the document on stdout, named after package.json', () => {
    write('package.json', '{ "name": "blog-api", "version": "2.0.0", "type": "module" }')
    const r = pangol('openapi')
    expect(r.code).toBe(0)
    const doc = JSON.parse(r.out)
    expect(doc).toMatchObject({ openapi: '3.1.0', info: { title: 'blog-api', version: '2.0.0' } })
    expect(Object.keys(doc.paths)).toEqual(['/health', '/posts/{id}'])
    expect(doc.paths['/posts/{id}'].get.security).toEqual([{ bearer: [] }])
  })

  it('openapi refuses a project that fails check', () => {
    write('src/routes/posts/[id].delete.ts', `import { route, t } from 'pangol'
export default route({ auth: 'user', params: t.object({ id: t.id() }), response: t.empty(), handler: (c) => c.noContent() })
`)
    const r = pangol('openapi')
    rmSync(join(project, 'src/routes/posts/[id].delete.ts'))
    expect(r.code).toBe(1)
    expect(r.out).toBe('')
  })

  it('wrong usage exits 2', () => {
    expect(pangol('chek').code).toBe(2)
    expect(pangol('check', '--rootx', '.').code).toBe(2)
    expect(pangol('diff').code).toBe(2)
    expect(pangol('diff', 'main', '--fail-on', 'low').code).toBe(2)
    expect(pangol('--help').code).toBe(0)
  })
})
