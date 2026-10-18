// Loads a project (src/routes, src/auth.js) and runs the build checks.
// Every problem is reported with the file, what is wrong, and an exact fix.
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { isRoute, isAuth } from './index.mjs'
import { isSchema } from './schema.mjs'

const METHODS = ['get', 'post', 'put', 'patch', 'delete']
const KEYS = ['auth', 'params', 'query', 'body', 'response', 'handler', 'load', 'owner', 'rateLimit', 'description']
const AUTH_HELP = "auth: 'user' (any signed-in user), auth: { permission: 'name' }, auth: 'optional' (user or anonymous) or auth: 'public'"

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}

// Levenshtein distance for "did you mean" hints
function dist(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 1; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
  return d[a.length][b.length]
}
const suggest = (k, list) => { const best = list.map((x) => [x, dist(k, x)]).sort((a, b) => a[1] - b[1])[0]; return best && best[1] <= 3 ? best[0] : null }

// "users/[id]/index.get.js" -> ["GET", "/users/:id", ["id"]]
export function routeFromFile(rel) {
  const parts = rel.split(path.sep)
  const m = parts[parts.length - 1].match(/^(.+)\.(get|post|put|patch|delete)\.m?js$/)
  if (!m) return null
  const segs = [...parts.slice(0, -1), m[1]].filter((s) => s !== 'index')
  const names = []
  const p = '/' + segs.map((s) => {
    const pm = s.match(/^\[([A-Za-z_][A-Za-z0-9_]*)\]$/)
    if (pm) { names.push(pm[1]); return ':' + pm[1] }
    return s
  }).join('/')
  return [m[2].toUpperCase(), p === '/' ? '/' : p, names]
}

// Does the handler's source read a context field? Matches c.body, ctx.body, ({ body }), { body: x } = c
function reads(src, field) {
  return new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*\\.\\s*${field}\\b`).test(src.replace(/\.\s*(?:fail|created|noContent)\b/g, '')) ||
    new RegExp(`\\(\\s*\\{[^)]*\\b${field}\\b[^)]*\\}`).test(src) ||
    new RegExp(`\\{[^}]*\\b${field}\\b[^}]*\\}\\s*=\\s*[A-Za-z_$][\\w$]*\\s*[;\\n]`).test(src)
}

export function checkRoute(def, method, routePath, paramNames) {
  const errs = []
  const E = (msg, fix) => errs.push(fix ? `${msg}\n  Fix: ${fix}` : msg)
  const where = `${method} ${routePath}`
  for (const k of Object.keys(def)) {
    if (!KEYS.includes(k)) { const s = suggest(k, KEYS); E(`${where}: unknown option \`${k}\`.`, s ? `did you mean \`${s}\`?` : `allowed options: ${KEYS.join(', ')}`) }
  }
  // auth
  const a = def.auth
  if (a === undefined) E(`${where} has no \`auth\`. Every route must say who may call it.`, `add ${AUTH_HELP}`)
  else if (!(a === 'public' || a === 'user' || a === 'optional' || (typeof a === 'object' && a !== null && typeof a.permission === 'string' && a.permission.length > 0 && Object.keys(a).length === 1)))
    E(`${where}: invalid auth value ${JSON.stringify(a)}.`, `use ${AUTH_HELP}`)
  // handler
  if (typeof def.handler !== 'function') { E(`${where} has no \`handler\` function.`, 'add handler: async (c) => { ... }'); return errs }
  const src = def.handler.toString()
  // schemas
  for (const k of ['params', 'query', 'body', 'response']) {
    if (def[k] !== undefined && !isSchema(def[k])) E(`${where}: \`${k}\` must be a schema built with t (e.g. t.object({...})).`, `${k}: t.object({ ... })`)
    else if (def[k] !== undefined && k !== 'response' && def[k].kind !== 'object') E(`${where}: \`${k}\` must be t.object({...}).`, `${k}: t.object({ field: t.string() })`)
  }
  if (def.response === undefined) E(`${where} has no \`response\` schema, so its output cannot be filtered or typed.`, 'add response: t.object({ ...fields the client may see }), t.array(...) for lists, or t.empty() with c.noContent()')
  if (paramNames.length) {
    if (def.params === undefined) E(`${where} has path params (${paramNames.join(', ')}) but no \`params\` schema.`, `add params: t.object({ ${paramNames.map((n) => `${n}: t.string()`).join(', ')} })`)
    else if (isSchema(def.params) && def.params.kind === 'object') {
      const keys = Object.keys(def.params.shape)
      for (const n of paramNames) if (!keys.includes(n)) E(`${where}: \`params\` schema is missing "${n}" from the file name.`, `add ${n}: t.string() to params`)
      for (const k of keys) if (!paramNames.includes(k)) E(`${where}: \`params\` has "${k}" but the file path has no [${k}] segment.`, `remove ${k} from params or rename the file`)
    }
  } else if (def.params !== undefined) E(`${where}: \`params\` given but the path has no [param] segments.`, 'remove params, or name the file like [id].get.js')
  if ((method === 'GET' || method === 'DELETE') && def.body !== undefined) E(`${where}: ${method} routes cannot have a \`body\`.`, 'move the fields to `query`, or use POST/PUT/PATCH')
  if (reads(src, 'body') && def.body === undefined) E(`${where}: handler reads c.body but the route has no \`body\` schema, so the input is unvalidated.`, 'add body: t.object({ ...expected fields })')
  if (reads(src, 'query') && def.query === undefined) E(`${where}: handler reads c.query but the route has no \`query\` schema.`, 'add query: t.object({ name: t.string().optional() })')
  if (reads(src, 'params') && def.params === undefined && !paramNames.length) E(`${where}: handler reads c.params but the path has no params.`, 'name the file with a [param] segment, e.g. [id].get.js')
  if (a === 'public' && reads(src, 'user')) E(`${where}: handler reads c.user but auth is 'public', so c.user is always null.`, "use auth: 'optional' if the route works for both signed-in and anonymous callers, or auth: 'user'")
  // ownership: a route that acts on one record (path params) and is not public must say who owns it
  const OWNER_HELP = "add load: (c) => db.things.get(c.params.id) and owner: (c, thing) => thing.ownerId === c.user.id; or owner: 'none' if every caller allowed by auth may access every record; or owner: 'query' if the handler's own query enforces it"
  if (def.owner !== undefined && !(typeof def.owner === 'function' || def.owner === 'none' || def.owner === 'query'))
    E(`${where}: invalid owner ${JSON.stringify(def.owner)}.`, OWNER_HELP)
  if (paramNames.length && a !== 'public' && a !== undefined && def.owner === undefined)
    E(`${where} acts on a specific record (${paramNames.map((n) => ':' + n).join(', ')}) but has no \`owner\` rule.`, OWNER_HELP)
  if (typeof def.owner === 'function' && typeof def.load !== 'function')
    E(`${where}: an owner function needs \`load\` to fetch the record it checks.`, 'add load: (c) => db.things.get(c.params.id)')
  if (def.load !== undefined && typeof def.load !== 'function') E(`${where}: \`load\` must be a function.`, 'load: (c) => db.things.get(c.params.id)')
  if (typeof def.load === 'function' && !reads(src, 'resource'))
    E(`${where} defines \`load\` but the handler never uses \`c.resource\`, so the record checked by \`owner\` may not be the one the handler acts on.`, 'use c.resource in the handler instead of reading c.params again')
  if (def.owner === 'none' && /\.fail\s*\(\s*403\b/.test(src))
    E(`${where} has owner: 'none' but the handler denies access with 403 itself, which hides the ownership rule from the security manifest.`, 'move the rule into owner: (c, record) => ... and add load')
  if (a === 'public' && typeof def.owner === 'function') E(`${where}: owner rule on a public route has no user to check.`, "use auth: 'user' or auth: 'optional'")
  if (def.rateLimit !== undefined && !(typeof def.rateLimit === 'string' && /^\d+\/(s|sec|min|m|h|hour)$/.test(def.rateLimit))) E(`${where}: invalid rateLimit ${JSON.stringify(def.rateLimit)}.`, "use a string like rateLimit: '10/min'")
  if (def.response?.kind === 'empty' && !/noContent\s*\(/.test(src)) E(`${where}: response is t.empty() but the handler never calls c.noContent().`, 'return c.noContent()')
  return errs
}

export async function loadProject(dir) {
  const problems = []
  const routesDir = path.join(dir, 'src/routes')
  const routes = []
  const seen = new Map()
  for (const file of walk(routesDir).sort()) {
    const rel = path.relative(routesDir, file)
    const base = path.basename(file)
    if (base.startsWith('_') || !/\.m?js$/.test(base)) continue
    const where = path.relative(dir, file)
    const r = routeFromFile(rel)
    if (!r) { problems.push(`✖ ${where}\n  Route files must be named <name>.<method>.js (get, post, put, patch, delete).\n  Fix: rename, e.g. users/index.get.js or users/[id].delete.js. Put shared helpers in files starting with _ or outside src/routes.`); continue }
    const [method, p, names] = r
    const key = `${method} ${p.replace(/:[^/]+/g, ':')}`
    if (seen.has(key)) { problems.push(`✖ ${where}\n  ${method} ${p} is also defined by ${seen.get(key)}.`); continue }
    seen.set(key, where)
    let mod
    try { mod = await import(pathToFileURL(file).href + `?v=${Date.now()}`) } catch (e) { problems.push(`✖ ${where}\n  could not load: ${e.message.split('\n')[0]}`); continue }
    const def = mod.default
    if (!isRoute(def)) { problems.push(`✖ ${where}\n  must \`export default route({ ... })\` (import { route, t } from 'hyperflat').`); continue }
    const errs = checkRoute(def, method, p, names)
    if (errs.length) { problems.push(`✖ ${where}\n  ${errs.join('\n  ').replace(/\n {2}Fix/g, '\n    Fix')}`); continue }
    routes.push({ method, path: p, segs: p.split('/').slice(1), def, file: where })
  }
  if (!routes.length && !problems.length) problems.push('✖ src/routes has no route files.\n  Fix: add a file like src/routes/health.get.js')
  let auth = null
  const authFile = ['src/auth.js', 'src/auth.mjs'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f))
  if (authFile) {
    try {
      const mod = await import(pathToFileURL(authFile).href)
      if (!isAuth(mod.default)) problems.push(`✖ ${path.relative(dir, authFile)}\n  must \`export default defineAuth({ resolve(token) { ... } })\`.`)
      else auth = mod.default
    } catch (e) { problems.push(`✖ ${path.relative(dir, authFile)}\n  could not load: ${e.message.split('\n')[0]}`) }
  } else if (routes.some((r) => r.def.auth !== 'public')) problems.push('✖ some routes need auth but src/auth.js is missing.\n  Fix: create src/auth.js with export default defineAuth({ resolve(token) { ... } })')
  return { routes, auth, problems }
}
