// Every server must answer the same before it is measured (SPEC section 14): same statuses, same
// filtered output, no leaked password hash. usage: node conform.mjs [server ...]
import { SERVERS, start, stop } from './servers.mjs'

const auth = (token) => ({ authorization: `Bearer ${token}` })
const json = { 'content-type': 'application/json' }
const good = { name: 'Ann', email: 'ann@example.com', age: 30 }
const keys = (...k) => (b) => Object.keys(b).sort().join() === k.sort().join()
// [label, method, path, headers, body, expected status (or 'invalid' = 400/422, '4xx'), check of the JSON body]
const CASES = [
  ['health', 'GET', '/health', {}, null, 200, (b) => b.ok === true],
  ['no token', 'GET', '/users/42', {}, null, 401],
  ['bad token', 'GET', '/users/42', auth('nope'), null, 401],
  ['own record', 'GET', '/users/42', auth('t-read'), null, 200, keys('id', 'name', 'email')],
  ['not the owner -> 404', 'GET', '/users/43', auth('t-read'), null, 404],
  ['admin reads any', 'GET', '/users/43', auth('t-admin'), null, 200, keys('id', 'name', 'email')],
  ['bad id', 'GET', '/users/abc', auth('t-admin'), null, 'invalid'],
  ['missing record', 'GET', '/users/99999', auth('t-admin'), null, 404],
  ['no write permission', 'POST', '/users', { ...auth('t-read'), ...json }, good, 403],
  ['create', 'POST', '/users', { ...auth('t-admin'), ...json }, good, 201, keys('age', 'email', 'id', 'name')],
  ['bad email', 'POST', '/users', { ...auth('t-admin'), ...json }, { ...good, email: 'x' }, 'invalid'],
  ['bad age', 'POST', '/users', { ...auth('t-admin'), ...json }, { ...good, age: 1.5 }, 'invalid'],
  ['broken JSON', 'POST', '/users', { ...auth('t-admin'), ...json }, '{"name":', 'invalid'],
  ['mass assignment', 'POST', '/users', { ...auth('t-admin'), ...json }, { ...good, role: 'admin' }, 201, (b) => !('role' in b)],
  ['wrong content-type', 'POST', '/users', { ...auth('t-admin'), 'content-type': 'text/plain' }, good, '4xx'],
  ['unknown route', 'GET', '/nope', {}, null, 404],
]

export async function conform(port) {
  const rows = []
  for (const [label, method, path, headers, body, want, check] of CASES) {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers, body: body === null ? undefined : typeof body === 'string' ? body : JSON.stringify(body) })
    const text = await res.text()
    let ok = want === '4xx' ? res.status >= 400 && res.status < 500 : want === 'invalid' ? res.status === 400 || res.status === 422 : res.status === want
    if (ok && check !== undefined) { try { ok = check(JSON.parse(text)) } catch { ok = false } }
    rows.push({ label, status: res.status, ok: ok && !text.includes('argon2') })
  }
  return rows
}

if (import.meta.filename === process.argv[1]) {
  const names = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SERVERS).filter((n) => !n.startsWith('raw-'))
  let allOk = true
  for (const name of names) {
    const p = await start(name, 3100)
    try {
      const rows = await conform(3100)
      const bad = rows.filter((r) => !r.ok)
      allOk &&= bad.length === 0
      console.log(`${name.padEnd(12)} ${rows.length - bad.length}/${rows.length}${bad.length ? '  FAIL: ' + bad.map((r) => `${r.label} (${r.status})`).join(', ') : ''}`)
    } finally { await stop(p) }
  }
  process.exit(allOk ? 0 : 1)
}
