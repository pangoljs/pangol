import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'

const bin = new URL('../dist/main.js', import.meta.url)
function sandbox(fn) {
  const root = mkdtempSync(join(tmpdir(), 'create-pangol-'))
  try { fn(root) } finally { rmSync(root, { recursive: true, force: true }) }
}
function run(root, args, input = '') {
  return spawnSync(process.execPath, [bin.pathname, ...args], { cwd: root, input, encoding: 'utf8' })
}
for (const runtime of ['node', 'bun']) {
  test(`creates a complete ${runtime} project without installing`, () => sandbox(root => {
    const r = run(root, ['my-app', '--runtime', runtime])
    assert.equal(r.status, 0, r.stderr)
    const dir = join(root, 'my-app')
    const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
    assert.equal(pkg.name, 'my-app')
    assert.equal(pkg.dependencies.pangol, '0.1.0-alpha.0')
    assert.deepEqual(Object.keys(pkg.scripts).sort(), ['build', 'check', 'dev', 'start', 'test'])
    assert.match(readFileSync(join(dir, 'src/server.ts'), 'utf8'), new RegExp(`pangol/${runtime}`))
    assert.match(readFileSync(join(dir, 'AGENTS.md'), 'utf8'), /npm run check/)
    assert.match(readFileSync(join(dir, '.gitignore'), 'utf8'), /\.pangol\//)
    assert.ok(!readdirSync(dir).includes('node_modules'))
    assert.ok(!readdirSync(dir).includes('package-lock.json'))
  }))
}
test('accepts an existing empty folder', () => sandbox(root => {
  mkdirSync(join(root, 'app'))
  assert.equal(run(root, ['app', '--runtime', 'node']).status, 0)
}))
test('never overwrites existing files, including hidden files', () => sandbox(root => {
  mkdirSync(join(root, 'app'))
  writeFileSync(join(root, 'app/.keep'), 'keep')
  const r = run(root, ['app', '--runtime', 'node'])
  assert.equal(r.status, 1)
  assert.match(r.stderr, /empty/)
  assert.deepEqual(readdirSync(join(root, 'app')), ['.keep'])
  assert.equal(readFileSync(join(root, 'app/.keep'), 'utf8'), 'keep')
}))
test('refuses symlink destinations and files', () => sandbox(root => {
  mkdirSync(join(root, 'real'))
  symlinkSync(join(root, 'real'), join(root, 'link'), 'dir')
  writeFileSync(join(root, 'file'), 'keep')
  for (const name of ['link', 'file']) assert.equal(run(root, [name, '--runtime', 'node']).status, 1)
  assert.deepEqual(readdirSync(join(root, 'real')), [])
}))
test('rejects bad arguments before creating anything', () => sandbox(root => {
  for (const args of [
    ['app', '--runtime', 'deno'], ['app', '--runtime'], ['app', '--force'],
    ['app', 'extra', '--runtime', 'node'], ['app'], [],
    ['bad name', '--runtime', 'node'], ['--runtime', 'node', '--runtime', 'bun', 'app'],
  ]) assert.equal(run(root, args).status, 2, JSON.stringify(args))
  assert.deepEqual(readdirSync(root), [])
}))
test('help and version need no prompts and write nothing', () => sandbox(root => {
  assert.match(run(root, ['--help']).stdout, /--runtime/)
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(run(root, ['--version']).stdout.trim(), pkg.version)
  assert.deepEqual(readdirSync(root), [])
}))

test('accepts nested paths and quotes shell characters in parent folders', () => sandbox(root => {
  const dir = "parent's $(example)/my-app"
  const r = run(root, [dir, '--runtime', 'node'])
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.stdout.includes("cd 'parent'\\''s $(example)/my-app'"), r.stdout)
  assert.equal(JSON.parse(readFileSync(join(root, dir, 'package.json'), 'utf8')).name, 'my-app')
}))
