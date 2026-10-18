// Starts each server and checks it returns the same statuses and the same filtered output.
// usage: node conform.mjs [name ...]
import { spawn } from 'node:child_process'

export const SERVERS = {
  'hyper-bun': ['bun', ['servers/hyper-bun.mjs']],
  'hyper-node': ['node', ['servers/hyper-node.mjs']],
  'hyper-bun-basic': ['bun', ['servers/hyper-bun-basic.mjs']],
  'hyper-bun-fullurl': ['bun', ['servers/hyper-bun-fullurl.mjs']],
  'hyper-node-basic': ['node', ['servers/hyper-node-basic.mjs']],
  'hono-bun': ['bun', ['servers/hono-bun.mjs']],
  'hono-node': ['node', ['servers/hono-node.mjs']],
  'elysia-bun': ['bun', ['servers/elysia-bun.mjs']],
  'go': ['servers/go/server', [], { GOMAXPROCS: '1' }],
}

export async function start(name, port, cpu) {
  const [cmd, args, env = {}] = SERVERS[name] ?? (name.startsWith('raw-') ? [name.endsWith('bun') ? 'bun' : 'node', [`servers/${name}.mjs`]] : [])
  const full = cpu === undefined ? [cmd, args] : ['taskset', ['-c', String(cpu), cmd, ...args]]
  const p = spawn(full[0], full[1], { env: { ...process.env, ...env, PORT: String(port), NODE_ENV: 'production' }, stdio: ['ignore', 'ignore', 'inherit'] })
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/health`); return p } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  p.kill()
  throw new Error(name + ' did not start')
}

const A = (t) => ({ authorization: `Bearer ${t}` })
const J = { 'content-type': 'application/json' }
const good = { name: 'Ann', email: 'ann@example.com', age: 30 }
const CASES = [
  ['health', 'GET', '/health', {}, null, 200, (b) => b.ok === true],
  ['no token', 'GET', '/users/42', {}, null, 401],
  ['bad token', 'GET', '/users/42', A('nope'), null, 401],
  ['read user', 'GET', '/users/42', A('t-read'), null, 200, (b) => Object.keys(b).sort().join() === 'email,id,name'],
  ['bad id', 'GET', '/users/abc', A('t-read'), null, 'invalid'],
  ['missing user', 'GET', '/users/99999', A('t-read'), null, 404],
  ['no write perm', 'POST', '/users', { ...A('t-read'), ...J }, good, 403],
  ['create', 'POST', '/users', { ...A('t-admin'), ...J }, good, 201, (b) => Object.keys(b).sort().join() === 'age,email,id,name'],
  ['bad email', 'POST', '/users', { ...A('t-admin'), ...J }, { ...good, email: 'x' }, 'invalid'],
  ['bad age', 'POST', '/users', { ...A('t-admin'), ...J }, { ...good, age: 1.5 }, 'invalid'],
  ['invalid json', 'POST', '/users', { ...A('t-admin'), ...J }, '{"name":', 400],
  ['mass assignment', 'POST', '/users', { ...A('t-admin'), ...J }, { ...good, role: 'admin' }, 201, (b) => !('role' in b)],
  ['__proto__ key', 'POST', '/users', { ...A('t-admin'), ...J }, '{"__proto__":{"polluted":1},"name":"Ann","email":"ann@example.com","age":30}', '201-or-400', (b) => !('polluted' in b) && ({}).polluted === undefined],
  ['wrong content-type', 'POST', '/users', { ...A('t-admin'), 'content-type': 'text/plain' }, good, '4xx'],
  ['unknown route', 'GET', '/nope', {}, null, 404],
]

export async function conform(name, port) {
  const rows = []
  for (const [label, method, path, headers, body, want, check] of CASES) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
    const text = await res.text()
    let ok = want === '4xx' ? res.status >= 400 && res.status < 500 : want === 'invalid' ? res.status === 400 || res.status === 422 : want === '201-or-400' ? res.status === 201 || res.status === 400 : res.status === want
    if (ok && check && res.status < 300) { try { ok = check(JSON.parse(text)) } catch { ok = false } }
    rows.push({ label, status: res.status, ok, leak: text.includes('argon2') })
  }
  return rows
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(SERVERS)
  let allOk = true
  for (const name of names) {
    const p = await start(name, 3100)
    try {
      const rows = await conform(name, 3100)
      const bad = rows.filter((r) => !r.ok || r.leak)
      allOk &&= bad.length === 0
      console.log(`${name.padEnd(11)} ${rows.length - bad.length}/${rows.length} pass` + (bad.length ? '  FAIL: ' + bad.map((r) => `${r.label}(${r.status}${r.leak ? ',LEAK' : ''})`).join(' ') : '') +
        `  [content-type -> ${rows.find((r) => r.label === 'wrong content-type').status}]`)
    } finally { p.kill(); await new Promise((r) => setTimeout(r, 300)) }
  }
  process.exit(allOk ? 0 : 1)
}
