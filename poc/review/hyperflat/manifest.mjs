// Security manifest: what every route exposes, built from the loaded route objects (not from a
// committed file), so it reflects helpers and shared code exactly as they run.
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12)

// schema -> list of field paths: "name", "meta.score", "[].id", "tags[]"
export function fields(s, prefix = '') {
  if (!s) return []
  if (s.kind === 'object') return Object.entries(s.shape).flatMap(([k, v]) => {
    const p = prefix ? `${prefix}.${k}` : k
    return v.kind === 'object' || v.kind === 'array' ? fields(v, p) : [p + (v.isOptional ? '?' : '')]
  })
  if (s.kind === 'array') return fields(s.item, `${prefix}[]`).length ? fields(s.item, `${prefix}[]`) : [`${prefix}[]`]
  if (s.kind === 'empty') return []
  return [prefix || '(value)']
}
const stripOpt = (f) => f.replace(/\?$/, '')
const hasArray = (s) => !!s && (s.kind === 'array' || (s.kind === 'object' && Object.values(s.shape).some(hasArray)))
const short = (src) => (src.length > 300 ? src.slice(0, 300) + '…' : src)

// local files a module imports, recursively ({ "src/x.js": hash })
function localDeps(file, root, seen = new Map()) {
  if (seen.has(file) || !fs.existsSync(file)) return seen
  const src = fs.readFileSync(file, 'utf8')
  seen.set(file, sha(src))
  for (const m of src.matchAll(/from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) localDeps(path.resolve(path.dirname(file), m[1]), root, seen)
  return seen
}
// names a route file imports -> file they come from
function importedNames(file) {
  const src = fs.readFileSync(file, 'utf8')
  const out = new Map()
  for (const m of src.matchAll(/import\s+([^'"]+?)\s+from\s+['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target = path.resolve(path.dirname(file), m[2])
    for (const part of m[1].replace(/[{}]/g, ',').split(',')) {
      const name = part.trim().split(/\s+as\s+/).pop()
      if (name && /^[A-Za-z_$][\w$]*$/.test(name)) out.set(name, target)
    }
  }
  return out
}

export function buildManifest(dir, routes) {
  const rel = (f) => path.relative(dir, f).split(path.sep).join('/')
  const authFile = ['src/auth.js', 'src/auth.mjs'].map((f) => path.join(dir, f)).find((f) => fs.existsSync(f))
  const out = { version: 1, auth: authFile ? { file: rel(authFile), deps: Object.fromEntries([...localDeps(authFile, dir)].map(([f, h]) => [rel(f), h])) } : null, routes: {} }
  for (const r of routes) {
    const d = r.def
    const abs = path.join(dir, r.file)
    const auth = typeof d.auth === 'object' ? `permission:${d.auth.permission}` : d.auth
    let owner = null
    if (typeof d.owner === 'function') {
      const src = d.owner.toString()
      // owner helpers imported from other files: track those files too
      const deps = {}
      for (const [name, target] of importedNames(abs)) {
        if (new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(src)) for (const [f, h] of localDeps(target, dir)) deps[rel(f)] = h
      }
      owner = { kind: 'rule', src: src.length > 300 ? src.slice(0, 300) + '…' : src, hash: sha(src), deps }
    } else if (d.owner) owner = { kind: d.owner }
    out.routes[`${r.method} ${r.path}`] = {
      file: r.file,
      auth,
      owner,
      params: r.segs.filter((s) => s.startsWith(':')).map((s) => s.slice(1)),
      query: fields(d.query),
      body: fields(d.body),
      response: fields(d.response),
      responseIsList: hasArray(d.response),
      load: typeof d.load === 'function' ? { src: short(d.load.toString()), hash: sha(d.load.toString()) } : null,
      usesUser: /\.user\b/.test(d.handler.toString()),
      rateLimit: d.rateLimit ?? null,
      handler: sha(d.handler.toString()),
    }
  }
  return out
}

// ------------------------------------------------------------------------------------- diff
const SECRET = /pass(word)?|hash|secret|token|api_?key|private|ssn|salt|otp|mfa|cvv|card_?number|pin$/i
const OWNERSHIP = /^(user|owner|author|creator|created_?by|tenant|org|organization|account|customer|seller|buyer)(_?id)?$/i
const PRIVILEGE = /^(role|roles|permissions?|scopes?|is_?admin|admin|is_?staff|is_?superuser|verified|is_?verified|email_?verified|approved|banned|plan|tier)$/i
const MONEY = /^(price|unit_?price|amount|total|subtotal|balance|credits?|discount|fee|cost|refund)$/i
const REF = /^ids?$|(Id|_id|Ids|_ids)$/ // "id" alone too: a record chosen in the body (added after V14)
const AUTH_RANK = (a) => (a === 'public' ? 0 : a === 'optional' ? 1 : a === 'user' ? 2 : 3)
const leaf = (f) => stripOpt(f).split(/[.[\]]+/).filter(Boolean).pop() ?? ''

function bodyFieldFindings(key, flds, out, verb) {
  for (const f of flds.map(stripOpt)) {
    const n = leaf(f)
    if (OWNERSHIP.test(n)) out.high.push(`\`${key}\` ${verb} \`${f}\` — the caller can choose which user/owner the record belongs to. Make sure it is taken from \`c.user\` instead.`)
    else if (PRIVILEGE.test(n)) out.high.push(`\`${key}\` ${verb} \`${f}\` — a privilege field the caller controls (mass assignment risk).`)
    else if (MONEY.test(n)) out.high.push(`\`${key}\` ${verb} \`${f}\` — a money field the caller controls. Prices and totals should be computed on the server.`)
    else if (REF.test(n)) out.check.push(`\`${key}\` ${verb} \`${f}\` — refers to another record. Check the handler verifies the caller may use that record.`)
  }
}

const ownerIgnoresCaller = (r) => r.owner?.kind === 'rule' && !/\.user\b/.test(r.owner.src)

function routeFindings(key, r, out, isNew) {
  if (ownerIgnoresCaller(r)) out.high.push(`\`${key}\` owner rule never looks at the caller (\`c.user\`): \`${r.owner.src}\` — it may allow everyone.`)
  if (r.auth === 'public') (r.params.length || !key.startsWith('GET ') ? out.high : out.check).push(`\`${key}\` is **public** — anyone can call it without signing in.`)
  if (r.owner?.kind === 'none' && r.params.length) {
    if (r.auth === 'user' || r.auth === 'optional') out.high.push(`\`${key}\` has \`owner: 'none'\` with auth \`${r.auth}\` — **any signed-in user can act on every record**. Confirm this is intended.`)
    else if (r.auth !== 'public') out.check.push(`\`${key}\` has \`owner: 'none'\` — every holder of \`${r.auth}\` can act on every record.`)
  }
  if (r.owner?.kind === 'query') out.check.push(`\`${key}\` has \`owner: 'query'\` — ownership is claimed to be enforced inside the handler's query. Check the query.`)
  for (const f of r.response) if (SECRET.test(leaf(f))) out.high.push(`\`${key}\` returns \`${stripOpt(f)}\` — looks like a secret.`)
  bodyFieldFindings(key, r.body, out, 'accepts body field')
  bodyFieldFindings(key, r.query, out, 'accepts query')
  if (isNew && r.responseIsList && r.auth !== 'public' && !r.auth.startsWith('permission:')) out.check.push(`\`${key}\` returns a list to ${r.auth === 'optional' ? 'anyone' : 'any signed-in user'} — check the handler only includes rows the caller may see.`)
}

export function diffManifests(a, b) {
  const out = { high: [], check: [], ok: [], info: [] }
  // authentication logic itself
  const authDeps = (m) => JSON.stringify(m.auth?.deps ?? {})
  if (authDeps(a) !== authDeps(b)) out.high.push(`Authentication logic changed (\`${b.auth?.file ?? a.auth?.file}\` or a file it imports) — affects **every** non-public route.`)

  for (const [key, r] of Object.entries(b.routes)) {
    const old = a.routes[key]
    if (!old) {
      const before = out.high.length + out.check.length
      routeFindings(key, r, out, true)
      if (out.high.length + out.check.length === before) out.ok.push(`\`${key}\` added — auth \`${r.auth}\`${r.owner ? `, owner \`${r.owner.kind === 'rule' ? r.owner.src : r.owner.kind}\`` : ''}${r.load ? `, load \`${r.load.src}\`` : ''}, response [${r.response.map(stripOpt).join(', ') || 'empty'}]`)
      continue
    }
    // auth
    if (r.auth !== old.auth) {
      if (AUTH_RANK(r.auth) < AUTH_RANK(old.auth) || (r.auth.startsWith('permission:') && old.auth.startsWith('permission:'))) {
        const msg = `\`${key}\` auth changed \`${old.auth}\` → \`${r.auth}\``
        ;(AUTH_RANK(r.auth) < AUTH_RANK(old.auth) ? out.high : out.check).push(msg + (AUTH_RANK(r.auth) < AUTH_RANK(old.auth) ? ' — **weaker**.' : '.'))
      } else out.info.push(`\`${key}\` auth tightened \`${old.auth}\` → \`${r.auth}\`.`)
    }
    // owner
    const ok = old.owner?.kind ?? 'missing', nk = r.owner?.kind ?? 'missing'
    if (ok !== nk) {
      if (nk === 'none' || nk === 'missing') out.high.push(`\`${key}\` owner changed \`${ok}\` → \`${nk}\` — **ownership is no longer checked**${r.auth === 'user' || r.auth === 'optional' ? '; any signed-in user can act on every record' : ''}.`)
      else if (nk === 'query') out.check.push(`\`${key}\` owner changed \`${ok}\` → \`query\` — check the handler's query enforces ownership.`)
      else out.info.push(`\`${key}\` now has an owner rule (was \`${ok}\`).`)
    } else if (nk === 'rule') {
      if (old.owner.hash !== r.owner.hash) out.check.push(`\`${key}\` owner rule changed:\n  - before: \`${old.owner.src}\`\n  - after:  \`${r.owner.src}\``)
      const changed = Object.keys({ ...old.owner.deps, ...r.owner.deps }).filter((f) => old.owner.deps[f] !== r.owner.deps[f])
      if (changed.length) out.check.push(`\`${key}\` owner rule uses code that changed: ${changed.map((f) => `\`${f}\``).join(', ')}.`)
    }
    if ((old.load?.hash ?? null) !== (r.load?.hash ?? null)) out.check.push(`\`${key}\` load changed (the record that \`owner\` checks):\n  - before: \`${old.load?.src ?? 'none'}\`\n  - after:  \`${r.load?.src ?? 'none'}\``)
    if (ownerIgnoresCaller(r) && !ownerIgnoresCaller(old)) out.high.push(`\`${key}\` owner rule no longer looks at the caller: \`${r.owner.src}\`.`)
    if (old.usesUser && !r.usesUser && r.auth !== 'public') out.high.push(`\`${key}\` handler no longer references \`c.user\` — any per-user filtering or checks it did are gone.`)
    else if (r.handler !== old.handler && !(r.responseIsList && r.auth !== 'public' && !r.auth.startsWith('permission:'))) out.info.push(`\`${key}\` handler logic changed (\`${r.file}\`) — business rules are not covered by the manifest; review the code.`)
    // response
    const oldResp = new Set(old.response.map(stripOpt)), added = r.response.map(stripOpt).filter((f) => !oldResp.has(f))
    const removed = [...oldResp].filter((f) => !r.response.map(stripOpt).includes(f))
    for (const f of added) (SECRET.test(leaf(f)) ? out.high : out.check).push(`\`${key}\` response now includes \`${f}\`${SECRET.test(leaf(f)) ? ' — **looks like a secret**' : ''}.`)
    if (removed.length) out.info.push(`\`${key}\` response no longer includes ${removed.map((f) => `\`${f}\``).join(', ')} (may break clients).`)
    // body
    const oldBody = new Set(old.body.map(stripOpt)), newBody = r.body.map(stripOpt).filter((f) => !oldBody.has(f))
    const before = out.high.length + out.check.length
    bodyFieldFindings(key, newBody, out, 'now accepts')
    if (newBody.length && out.high.length + out.check.length === before) out.info.push(`\`${key}\` body now accepts ${newBody.map((f) => `\`${f}\``).join(', ')}.`)
    // query
    const oldQ = new Set(old.query.map(stripOpt))
    const newQ = r.query.map(stripOpt).filter((f) => !oldQ.has(f))
    bodyFieldFindings(key, newQ, out, 'now accepts query')
    // list handler logic
    if (r.responseIsList && r.handler !== old.handler && r.auth !== 'public' && !r.auth.startsWith('permission:')) out.check.push(`\`${key}\` returns a list and its handler changed — check row filtering (who sees which rows).`)
    if (old.rateLimit && !r.rateLimit) out.check.push(`\`${key}\` rate limit removed (was \`${old.rateLimit}\`).`)
  }
  for (const key of Object.keys(a.routes)) if (!b.routes[key]) out.info.push(`\`${key}\` removed (breaks clients that call it).`)
  return out
}

export function renderDiff(d, title) {
  const n = (x) => x.length
  const lines = [`## hyperflat security diff${title ? ` (${title})` : ''}`, '', `🔴 ${n(d.high)} need review · 🟡 ${n(d.check)} to check · ✓ ${n(d.ok)} complete · ℹ ${n(d.info)} info`, '']
  const sect = (icon, name, list) => { if (list.length) lines.push(`### ${icon} ${name}`, ...list.map((x) => `- ${x}`), '') }
  sect('🔴', 'Needs review', d.high)
  sect('🟡', 'Check', d.check)
  sect('✓', 'New routes with complete declarations', d.ok)
  sect('ℹ', 'Info', d.info)
  if (!n(d.high) && !n(d.check) && !n(d.ok) && !n(d.info)) lines.push('No security-relevant changes.')
  return lines.join('\n')
}
