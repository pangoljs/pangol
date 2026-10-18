// Build-time compiler: route definitions -> one JS module of straight-line functions.
// No middleware arrays, no loops over plugins at request time: auth, validation,
// handler call and serialization are inlined per route.
//
// usage: node hyper/compile.mjs <app module> <out dir>
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const [appPath, outDir] = [path.resolve(process.argv[2]), path.resolve(process.argv[3])]
const app = await import(pathToFileURL(appPath).href)
const appImport = path.relative(outDir, appPath).split(path.sep).join('/')

const BODY_LIMIT = 1024 * 1024
const STRICT = process.env.STRICT !== '0' // strict parsers on by default; STRICT=0 builds the PoC 2 variant
const strictImport = path.relative(outDir, path.resolve(path.dirname(new URL(import.meta.url).pathname), 'strict.mjs')).split(path.sep).join('/')
const problems = []

// ---- permissions -> bits ----
const permBits = new Map()
for (const [, , r] of app.routes) {
  if (r.auth && typeof r.auth === 'object' && !permBits.has(r.auth.permission)) {
    if (permBits.size === 30) throw new Error('PoC supports 30 permissions')
    permBits.set(r.auth.permission, 1 << permBits.size)
  }
}

// ---- validators: schema -> code that builds a NEW object with known keys only ----
let regexes = []
function check(schema, expr, label) {
  const fail = `{ ERR = ${JSON.stringify(label)}; return undefined }`
  switch (schema.kind) {
    case 'string': {
      let c = `if (typeof ${expr} !== 'string' || ${expr}.length < ${schema.min} || ${expr}.length > ${schema.max}) ${fail}`
      if (schema.pattern) { regexes.push(schema.pattern); c += `\n  if (!RE${regexes.length - 1}.test(${expr})) ${fail}` }
      return c
    }
    case 'email': // length first, so the regex only ever sees bounded input
      regexes.push('^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$')
      return `if (typeof ${expr} !== 'string' || ${expr}.length > ${schema.max} || !RE${regexes.length - 1}.test(${expr})) ${fail}`
    case 'int':
      return `if (typeof ${expr} !== 'number' || !Number.isInteger(${expr}) || ${expr} < ${schema.min} || ${expr} > ${schema.max}) ${fail}`
    case 'bool':
      return `if (typeof ${expr} !== 'boolean') ${fail}`
    default: throw new Error('unsupported schema ' + schema.kind)
  }
}
function validator(name, schema) {
  if (schema.kind !== 'object') throw new Error('top-level schema must be an object')
  const keys = Object.keys(schema.shape)
  const lines = keys.map((k, i) => `const v${i} = o[${JSON.stringify(k)}]\n  ${check(schema.shape[k], `v${i}`, k)}`)
  return `function ${name}(o) {
  if (typeof o !== 'object' || o === null || Array.isArray(o)) { ERR = 'body'; return undefined }
  ${lines.join('\n  ')}
  return { ${keys.map((k, i) => `${JSON.stringify(k)}: v${i}`).join(', ')} }
}`
}
// ---- serializers: only declared fields are written (passwordHash etc. can never leak) ----
function serializer(name, schema) {
  const parts = Object.entries(schema.shape).map(([k, s], i) => {
    const pre = JSON.stringify((i ? ',' : '{') + JSON.stringify(k) + ':')
    const v = `o[${JSON.stringify(k)}]`
    const val = s.kind === 'int' ? `(Number.isFinite(${v}) ? '' + ${v} : 'null')`
      : s.kind === 'bool' ? `(${v} === true ? 'true' : 'false')`
      : `JSON.stringify(String(${v}))`
    return `${pre} + ${val}`
  })
  return `function ${name}(o) { return ${parts.join(' + ')} + '}' }`
}

// ---- per-route pipeline ----
const fns = []
const routeTable = []
app.routes.forEach(([method, p, r], i) => {
  const where = `${method} ${p}`
  if (!r.auth) problems.push(`✖ ${where} has no \`auth\`. Fix: add auth: 'user', auth: { permission: '...' } or auth: 'public'`)
  if (!r.response) problems.push(`✖ ${where} has no \`response\` schema. Fix: add response: t.object({...})`)
  const hasParams = p.includes(':')
  if (hasParams && !r.params) problems.push(`✖ ${where} has path params but no \`params\` schema.`)
  if (r.params) fns.push(validator(`VP${i}`, r.params))
  if (r.body) fns.push(validator(`VB${i}`, r.body))
  if (r.response) fns.push(serializer(`S${i}`, r.response))
  routeTable.push({ i, method, path: p, r })
})
if (problems.length) { console.error(problems.join('\n')); process.exit(1) }

// adapter-specific snippets: how to read a header, send a response, read the body
const adapters = {
  bun: {
    sig: (i) => `async function R${i}(req)`,
    header: (h) => `req.headers.get(${JSON.stringify(h)})`,
    params: 'req.params',
    send: (status, body) => `new Response(${body}, { status: ${status}, headers: H })`,
    readJson: `const cl = req.headers.get('content-length')
  if (cl === null) return E(411, 'content-length required')
  if (+cl > ${BODY_LIMIT}) return E(413, 'body too large')
  let raw
  try { raw = ${STRICT ? 'parseJson(await req.text())' : 'await req.json()'} } catch (e) { return e instanceof Reject ? E(e.status, e.code) : E(400, 'invalid json') }`,
  },
  node: {
    sig: (i) => `async function R${i}(req, res, rawParams)`,
    header: (h) => `req.headers[${JSON.stringify(h)}]`,
    params: 'rawParams',
    send: (status, body) => `send(res, ${status}, ${body})`,
    readJson: `const cl = req.headers['content-length']
  if (cl === undefined) return E(res, 411, 'content-length required')
  if (+cl > ${BODY_LIMIT}) return E(res, 413, 'body too large')
  let raw
  try { raw = ${STRICT ? 'parseJson' : 'JSON.parse'}(await readBody(req, ${BODY_LIMIT})) } catch (e) { return e === 413 ? E(res, 413, 'body too large') : e instanceof Reject ? E(res, e.status, e.code) : E(res, 400, 'invalid json') }`,
  },
}

function pipeline(kind, { i, r, path: routePath }) {
  const a = adapters[kind]
  const E = kind === 'bun' ? 'E(' : 'E(res, '
  const L = []
  // Bun routes natively and hands over decoded params, so each param value is checked here
  // (reading req.url would be slow on Bun and it is already normalized). Node checks the raw
  // request-target in dispatch(). STRICT_URL=1 also checks req.url on Bun.
  if (STRICT && kind === 'bun') {
    if (process.env.STRICT_URL === '1') L.push(`if (!validTarget(req.url)) return E(400, 'invalid path')`)
    const names = routePath.split('/').filter((x) => x.startsWith(':')).map((x) => x.slice(1))
    if (names.length) L.push(`const rp = req.params // read once: each access builds a new object in Bun\n  if (${names.map((n) => `!safeSegment(rp[${JSON.stringify(n)}])`).join(' || ')}) return E(400, 'invalid path')`)
  }
  if (r.auth !== 'public') {
    L.push(`const h = ${a.header('authorization')}
  if (h == null || !h.startsWith('Bearer ')) return ${E}401, 'unauthorized')
  const user = auth.resolve(h.slice(7))
  if (user == null) return ${E}401, 'unauthorized')`)
    if (typeof r.auth === 'object') {
      const bit = permBits.get(r.auth.permission)
      L.push(`if ((mask(user) & ${bit}) !== ${bit}) return ${E}403, 'forbidden') // ${r.auth.permission}`)
    }
  }
  const paramSrc = STRICT && kind === 'bun' && routePath.includes(':') ? 'rp' : a.params
  if (r.params) L.push(`const params = VP${i}(${paramSrc})\n  if (params === undefined) return ${E}400, 'invalid ' + ERR)`)
  if (r.body) {
    L.push(`const ct = ${a.header('content-type')}
  if (${STRICT ? '!isJson(ct)' : "ct == null || !(ct === 'application/json' || ct.toLowerCase() === 'application/json' || ct.toLowerCase().startsWith('application/json;'))"}) return ${E}415, 'expected application/json')
  ${a.readJson}
  const body = VB${i}(raw)
  if (body === undefined) return ${E}400, 'invalid ' + ERR)`)
  }
  // Routes that never read a body run fully synchronously: no Promise is created unless
  // the user's handler itself is async.
  const R = kind === 'bun' ? '' : ', res'
  L.push(`const c = { params: ${r.params ? 'params' : 'undefined'}, body: ${r.body ? 'body' : 'undefined'}, user: ${r.auth === 'public' ? 'null' : 'user'}, fail, created }
  const out = H${i}(c)
  if (out !== null && typeof out === 'object' && typeof out.then === 'function') return out.then((o) => F${i}(o${R}))
  return F${i}(out${R})`)
  const finish = `function F${i}(out${R}) {
  if (out instanceof Fail) return ${E}out.status, out.message)
  if (out instanceof Created) return ${a.send(201, `S${i}(out.value)`)}
  return ${a.send(200, `S${i}(out)`)}
}`
  const sig = r.body ? a.sig(i) : a.sig(i).replace('async function', 'function')
  return `${finish}\n${sig} {\n  ${L.join('\n  ')}\n}`
}

const common = `// GENERATED by hyper/compile.mjs — do not edit
import { routes, auth } from '${appImport.startsWith('.') ? appImport : './' + appImport}'
${STRICT ? `import { validTarget, safeSegment, isJson, parseJson, Reject } from '${strictImport}'` : 'class Reject {}'}
${routeTable.map(({ i }) => `const H${i} = routes[${i}][2].handler`).join('\n')}
let ERR = ''
${regexes.map((re, i) => `const RE${i} = new RegExp(${JSON.stringify(re)})`).join('\n')}
class Fail { constructor(status, message) { this.status = status; this.message = message } }
class Created { constructor(value) { this.value = value } }
const fail = (status, message) => new Fail(status, message)
const created = (value) => new Created(value)
const PERM_BITS = new Map(${JSON.stringify([...permBits])})
const masks = new WeakMap()
function mask(user) { // permission names -> bit mask, computed once per session object
  let m = masks.get(user)
  if (m === undefined) { m = 0; for (const p of user.permissions ?? []) m |= PERM_BITS.get(p) ?? 0; masks.set(user, m) }
  return m
}
${fns.join('\n')}
`

// ---- Bun: native router ----
const bunRoutes = {}
for (const { i, method, path: p } of routeTable) (bunRoutes[p] ??= {})[method] = `R${i}`
const bun = `${common}
const H = { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' }
const E = (status, message) => new Response('{"error":' + JSON.stringify(message) + '}', { status, headers: H })
${routeTable.map((rt) => pipeline('bun', rt)).join('\n')}
export function serve(port) {
  return Bun.serve({
    port,
    maxRequestBodySize: ${BODY_LIMIT},
    routes: { ${Object.entries(bunRoutes).map(([p, ms]) => `${JSON.stringify(p)}: { ${Object.entries(ms).map(([m, f]) => `${m}: ${f}`).join(', ')} }`).join(',\n      ')} },
    fetch: () => E(404, 'not found'),
    error: () => E(500, 'internal error'),
  })
}
`

// ---- Node: node:http + generated dispatcher (no Request objects are created) ----
const staticRoutes = routeTable.filter((r) => !r.path.includes(':'))
const dynRoutes = routeTable.filter((r) => r.path.includes(':'))
const byPath = (list) => list.reduce((m, r) => ((m[r.path] ??= []).push(r), m), {})
const dispatchStatic = Object.entries(byPath(staticRoutes)).map(([p, rs]) =>
  `    case ${JSON.stringify(p)}:\n${rs.map((r) => `      if (m === '${r.method}') return R${r.i}(req, res, undefined)`).join('\n')}\n      return E(res, 405, 'method not allowed')`).join('\n')
const dispatchDyn = Object.entries(byPath(dynRoutes)).map(([p, rs]) => {
  const segs = p.split('/').slice(1)
  const conds = [`s.length === ${segs.length + 1}`, ...segs.map((x, j) => (x.startsWith(':') ? `s[${j + 1}] !== ''` : `s[${j + 1}] === ${JSON.stringify(x)}`))]
  const obj = `{ ${segs.map((x, j) => (x.startsWith(':') ? `${JSON.stringify(x.slice(1))}: s[${j + 1}]` : null)).filter(Boolean).join(', ')} }`
  return `  if (${conds.join(' && ')}) {\n${rs.map((r) => `    if (m === '${r.method}') return R${r.i}(req, res, ${obj})`).join('\n')}\n    return E(res, 405, 'method not allowed')\n  }`
}).join('\n')

const node = `${common}
import http from 'node:http'
const H = { 'content-type': 'application/json', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' }
function send(res, status, body) { res.writeHead(status, H); res.end(body) }
function E(res, status, message) { send(res, status, '{"error":' + JSON.stringify(message) + '}') }
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(413); req.destroy() } else chunks.push(c) })
    req.on('end', () => resolve(chunks.length === 1 ? chunks[0].toString() : Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}
${routeTable.map((rt) => pipeline('node', rt)).join('\n')}
function dispatch(req, res) {
  const url = req.url
  const q = url.indexOf('?')
  const p = q === -1 ? url : url.slice(0, q)
  // strict path: reject ambiguous forms instead of normalizing them
  ${STRICT ? `if (!validTarget(url)) return E(res, 400, 'invalid path')` : `if (p.charCodeAt(0) !== 47 || p.indexOf('//') !== -1 || p.indexOf('/.') !== -1 || p.indexOf('%2') !== -1 || p.indexOf('\\\\') !== -1) return E(res, 400, 'invalid path')`}
  const m = req.method
  switch (p) {
${dispatchStatic}
  }
  const s = p.split('/')
${dispatchDyn}
  return E(res, 404, 'not found')
}
export function serve(port) {
  const server = http.createServer((req, res) => {
    const r = dispatch(req, res)
    if (r !== undefined && typeof r.catch === 'function') r.catch(() => { if (!res.headersSent) E(res, 500, 'internal error') })
  })
  server.requestTimeout = 10_000
  server.headersTimeout = 5_000
  server.listen(port)
  return server
}
`
fs.mkdirSync(outDir, { recursive: true })
fs.writeFileSync(path.join(outDir, 'bun.mjs'), bun)
fs.writeFileSync(path.join(outDir, 'node.mjs'), node)
console.log(`${STRICT ? 'strict' : 'basic'}: compiled ${routeTable.length} routes, ${permBits.size} permissions -> ${path.relative(process.cwd(), outDir)}/{bun,node}.mjs`)
