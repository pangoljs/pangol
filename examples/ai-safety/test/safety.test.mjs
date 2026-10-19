import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { createApp } from 'pangol'
import auth from '../src/auth.mjs'
import getPost from '../src/routes/posts/[id].get.mjs'
import draft from '../src/routes/posts/index.post.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const cli = fileURLToPath(new URL('../node_modules/pangol/dist/cli/main.js', import.meta.url))
const getFile = 'src/routes/posts/[id].get.mjs'
const postFile = 'src/routes/posts/index.post.mjs'
const check = (cwd) => spawnSync(process.execPath, [cli, 'check'], { cwd, encoding: 'utf8' })
function changed(file, from, to, work) {
  const dir = mkdtempSync(join(tmpdir(), 'pangol-ai-safety-'))
  try {
    cpSync(join(root, 'src'), join(dir, 'src'), { recursive: true })
    symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules'), 'dir')
    const source = readFileSync(join(dir, file), 'utf8')
    assert.ok(source.includes(from), 'mutation must match the documented source')
    writeFileSync(join(dir, file), source.replace(from, to))
    return work(dir)
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

test('documented safe project passes the real pangol check CLI', () => {
  const result = check(root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /2 route\(s\) checked, no problems/)
})
for (const [name, file, from, to, rule] of [
  ['missing auth', getFile, "  auth: 'user',\n", '', 'C1'],
  ['missing response', getFile, '  response: Post.public(),\n', '', 'C2'],
  ['reading body without schema', postFile, "  body: t.object({ title: t.string({ min: 1, max: 100 }) }),\n", '', 'C3'],
  ['missing owner on protected record route', getFile, '  owner: (c, post) => post.ownerId === c.user.id,\n', '', 'C6'],
  ['private field included in response schema', getFile, 'response: Post.public()', 'response: Post', 'C10'],
]) {
  test(`build check rejects ${name} (${rule})`, () => changed(file, from, to, (dir) => {
    const result = check(dir)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.ok(result.stderr.includes(`(${rule})`), result.stderr)
    assert.ok(result.stderr.includes(file), result.stderr)
  }))
}
const app = createApp({ auth, routes: { 'GET /posts/:id': getPost, 'POST /posts': draft } })
const send = (path, user, body) => app.fetch(new Request('http://example.test' + path, {
  method: body === undefined ? 'GET' : 'POST',
  headers: { ...(user ? { authorization: `Bearer ${user}` } : {}), ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
}))
test('runtime: missing/invalid credentials get 401; owner gets a filtered 200', async () => {
  for (const user of [undefined, 'forged']) assert.equal((await send('/posts/p1', user)).status, 401)
  const response = await send('/posts/p1', 'alice')
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { id: 'p1', title: 'Hello', ownerId: 'alice' })
})
test('runtime: another owner and absent record have the same 404 response', async () => {
  for (const path of ['/posts/p1', '/posts/absent']) {
    const response = await send(path, 'bob')
    assert.equal(response.status, 404)
    assert.deepEqual(await response.json(), { error: 'not found' })
  }
})
test('runtime: invalid title rejected; extra input fields dropped before handler', async () => {
  assert.equal((await send('/posts', 'alice', { title: 42 })).status, 400)
  for (const body of [{ title: 'Draft' }, { title: 'Draft', ownerId: 'bob', isAdmin: true, internalNote: 'injected' }]) {
    const response = await send('/posts', 'alice', body)
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { title: 'Draft', ownerId: 'alice' })
  }
})
test('limit: deliberately public draft route passes check and accepts anonymous calls', () => {
  changed(postFile, "auth: 'user'", "auth: 'public'", (dir) => {
    const file = join(dir, postFile)
    writeFileSync(file, readFileSync(file, 'utf8').replace('ownerId: c.user.id', "ownerId: 'alice'"))
    assert.equal(check(dir).status, 0, 'checker cannot infer that this business operation should require login')
    const script = `import { createApp } from 'pangol';
import draft from './src/routes/posts/index.post.mjs';
const app = createApp({ routes: { 'POST /posts': draft } });
const r = await app.fetch(new Request('http://x/posts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"title":"Anonymous"}' }));
console.log(r.status, await r.text());`
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: dir, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(result.stdout.trim(), '200 {"title":"Anonymous","ownerId":"alice"}')
  })
})
