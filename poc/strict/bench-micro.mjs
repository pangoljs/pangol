// Per-operation cost of the strict parsers vs the plain alternative, plus the O(n²) pattern
// behind the Elysia CVE for contrast.  run: node bench-micro.mjs   (or: bun bench-micro.mjs)
import { pathFromUrl, isJson, parseJson, parseMultipart, MULTIPART_LIMITS } from './strict.mjs'

function ns(fn, iters = 2_000_000) {
  for (let i = 0; i < 200_000; i++) fn() // warm-up / JIT
  const t = process.hrtime.bigint()
  for (let i = 0; i < iters; i++) fn()
  return Number(process.hrtime.bigint() - t) / iters
}
let sink = 0
const small = '{"name":"Ann","email":"ann@example.com","age":30}'
const big = JSON.stringify({ items: Array.from({ length: 120 }, (_, i) => ({ id: i, name: 'item ' + i, tags: ['a', 'b'], price: i * 1.5 })) })
const rows = [
  ['path (absolute, Bun-style)', () => { sink += pathFromUrl('http://localhost:3000/users/42?x=1').length }, () => { const u = 'http://localhost:3000/users/42?x=1'; const s = u.indexOf('/', 8); const q = u.indexOf('?', s); sink += (q === -1 ? u.slice(s) : u.slice(s, q)).length }],
  ['path (origin-form, Node-style)', () => { sink += pathFromUrl('/users/42?x=1').length }, () => { const u = '/users/42?x=1'; const q = u.indexOf('?'); sink += (q === -1 ? u : u.slice(0, q)).length }],
  ['content-type check', () => { sink += isJson('application/json; charset=utf-8') ? 1 : 0 }, () => { const c = 'application/json; charset=utf-8'; sink += c === 'application/json' || c.startsWith('application/json;') ? 1 : 0 }],
  [`JSON body ${small.length} B`, () => { sink += parseJson(small).age }, () => { sink += JSON.parse(small).age }],
  [`JSON body ${(big.length / 1024).toFixed(0)} KB`, () => { sink += parseJson(big).items.length }, () => { sink += JSON.parse(big).items.length }, 20_000],
]
console.log('operation'.padEnd(32), 'strict'.padStart(10), 'plain'.padStart(10), 'extra'.padStart(10))
for (const [name, strict, plain, iters] of rows) {
  const a = ns(strict, iters), b = ns(plain, iters)
  console.log(name.padEnd(32), `${a.toFixed(0)} ns`.padStart(10), `${b.toFixed(0)} ns`.padStart(10), `+${(a - b).toFixed(0)} ns`.padStart(10))
}

// Elysia CVE-2026-56669 pattern: normalize FormData by calling getAll() for every key -> O(n²)
function body(n) { let s = ''; for (let i = 0; i < n; i++) s += `--B\r\nContent-Disposition: form-data; name="f${i}"\r\n\r\nv\r\n`; return s + '--B--\r\n' }
async function vulnerable(n) {
  const fd = await new Response(body(n), { headers: { 'content-type': 'multipart/form-data; boundary=B' } }).formData()
  const t = performance.now()
  const out = {}
  for (const k of fd.keys()) { const all = fd.getAll(k); out[k] = all.length === 1 ? all[0] : all }
  return performance.now() - t
}
function ours(n) {
  const b = Buffer.from(body(n))
  const t = performance.now()
  parseMultipart(b, 'B', { ...MULTIPART_LIMITS, maxParts: 1e9 })
  return performance.now() - t
}
console.log('\nmultipart with N unique fields (limit disabled to show growth):')
console.log('N'.padStart(7), 'getAll-per-key'.padStart(16), 'ours (parse all)'.padStart(18))
for (const n of [2000, 8000, 32000]) console.log(String(n).padStart(7), `${(await vulnerable(n)).toFixed(1)} ms`.padStart(16), `${ours(n).toFixed(1)} ms`.padStart(18))
console.log('(with the default limit, anything over 100 parts is rejected before parsing further)')
if (sink === 42) console.log('')
