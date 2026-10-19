// `pangol diff`: compare two security manifests and sort what changed by risk (SPEC section 10).
// Many rules read field names, so a renamed field can dodge them: 🟡 means "go read the code", not
// a verdict, and business logic inside handlers only ever shows up as ℹ.
import type { Manifest, RouteManifest } from './manifest.js'

export type Level = 'high' | 'medium' | 'ok' | 'info'
export interface Change {
  readonly level: Level
  readonly route?: string
  readonly what: string
  readonly before?: string
  readonly after?: string
}

// --------------------------------------------------------------- field names

const words = (name: string) => name.replace(/\[\]|\?/g, '').split('.').pop()!
  .split(/[_\-\s]+|(?<=[a-z0-9])(?=[A-Z])/).filter(Boolean).map((w) => w.toLowerCase())
const flat = (name: string) => words(name).join('')
const SECRET = new Set(['password', 'passwd', 'secret', 'secrets', 'token', 'tokens', 'hash', 'salt', 'ssn', 'otp', 'credential', 'credentials', 'apikey', 'privatekey'])
const OWNER = new Set(['userid', 'ownerid', 'authorid', 'createdby', 'creatorid', 'accountid', 'customerid', 'tenantid', 'orgid', 'organizationid', 'memberid', 'owner', 'user', 'uid'])
const PRIVILEGE = new Set(['role', 'roles', 'admin', 'isadmin', 'superuser', 'issuperuser', 'isstaff', 'staff', 'permission', 'permissions', 'scope', 'scopes', 'verified', 'isverified', 'emailverified', 'approved', 'isapproved', 'plan', 'tier'])
const MONEY = new Set(['price', 'amount', 'total', 'subtotal', 'balance', 'cost', 'fee', 'fees', 'discount', 'credit', 'credits', 'refund', 'salary', 'payout', 'tax'])

export const looksSecret = (field: string) => {
  const w = words(field)
  return w.some((x) => SECRET.has(x)) || SECRET.has(w.join('')) || /(api|private|secret)key/.test(w.join(''))
}
export const isOwnerField = (field: string) => OWNER.has(flat(field))
export const isPrivilegeField = (field: string) => PRIVILEGE.has(flat(field))
export const isMoneyField = (field: string) => words(field).some((x) => MONEY.has(x))
const isOtherId = (field: string) => { const w = words(field); return w.length > 1 && w[w.length - 1] === 'id' }

// --------------------------------------------------------------- auth

type Auth = RouteManifest['auth']
const rank = (a: Auth) => (typeof a === 'object' ? 3 : a === 'user' ? 2 : a === 'optional' ? 1 : 0)
const showAuth = (a: Auth) => (typeof a === 'object' ? `{ permission: '${a.permission}' }` : `'${a}'`)
const method = (key: string) => key.slice(0, key.indexOf(' '))
const hasParams = (key: string) => key.includes('/:')
// Becoming public is 🔴, except a GET without params (a listing or a health check): 🟡
const publicLevel = (key: string): Level => (method(key) === 'GET' && !hasParams(key) ? 'medium' : 'high')

// --------------------------------------------------------------- rules

function inputRules(key: string, source: 'body' | 'query', fields: readonly string[], push: (c: Change) => void) {
  for (const f of fields) {
    if (isOwnerField(f)) push({ level: 'high', route: key, what: `${source} accepts \`${f}\`, an owner field: the caller may set who owns the record` })
    else if (isPrivilegeField(f)) push({ level: 'high', route: key, what: `${source} accepts \`${f}\`, a privilege field: the caller may grant itself rights` })
    else if (isMoneyField(f)) push({ level: 'high', route: key, what: `${source} accepts \`${f}\`, a money field: the caller may set a price or amount` })
    else if (isOtherId(f)) push({ level: 'medium', route: key, what: `${source} accepts \`${f}\`, the id of another record: \`owner\` does not check it` })
  }
}

// SPEC section 18: a money-named field declared as a number (new, or newly a number)
function moneyAsNumber(key: string, base: RouteManifest | undefined, head: RouteManifest, push: (c: Change) => void) {
  for (const source of ['body', 'query', 'response'] as const) {
    for (const [f, kind] of Object.entries(head[source])) {
      if (isMoneyField(f) && /^(number|int)\??$/.test(kind) && base?.[source][f] !== kind) push({ level: 'high', route: key, what: `${source} field \`${f}\` looks like money but is t.${kind.replace('?', '')}(): use t.money()` })
    }
  }
}

function ownerRules(key: string, base: RouteManifest | undefined, head: RouteManifest, push: (c: Change) => void) {
  const o = head.owner
  const was = base?.owner
  if (o.kind === 'function') {
    const changed = was === undefined || was.kind !== 'function' || was.hash !== o.hash
    if (changed && o.usesUser === false) push({ level: 'high', route: key, what: 'the owner rule never reads c.user, so it does not depend on who is calling', after: o.source })
    else if (changed && o.usesUser === 'unknown') push({ level: 'medium', route: key, what: 'cannot tell whether the owner rule reads c.user', after: o.source })
    if (was?.kind === 'function' && was.hash !== o.hash) push({ level: 'medium', route: key, what: 'the owner rule changed', before: was.source, after: o.source })
    if (base !== undefined) {
      const changedImports = Object.keys(head.imports).filter((f) => base.imports[f] !== undefined && base.imports[f] !== head.imports[f])
      if (changedImports.length > 0) push({ level: 'medium', route: key, what: `files this route imports changed (the owner rule may call them): ${changedImports.join(', ')}` })
    }
  } else if (o.kind === 'none' || o.kind === 'missing') {
    if (was === undefined ? hasParams(key) && head.auth !== 'public' : was.kind === 'function' || was.kind === 'query') {
      const level: Level = typeof head.auth === 'object' && was === undefined ? 'medium' : 'high'
      push({ level, route: key, what: was === undefined ? `owner: '${o.kind}': every caller allowed by auth ${showAuth(head.auth)} may act on every record` : `owner became '${o.kind}' (was ${was.kind === 'function' ? 'a function' : `'${was.kind}'`})`, ...(was?.kind === 'function' && { before: was.source }) })
    }
  } else if (o.kind === 'query' && was?.kind !== 'query') {
    push({ level: 'medium', route: key, what: "owner: 'query': the handler must filter by the user itself; this cannot be checked" })
  }
}

function routeChanges(key: string, base: RouteManifest | undefined, head: RouteManifest): Change[] {
  const out: Change[] = []
  const push = (c: Change) => out.push(c)

  if (base === undefined) {
    if (head.auth === 'public') push({ level: publicLevel(key), route: key, what: 'new public route: anyone can call it' })
  } else if (rank(head.auth) < rank(base.auth)) {
    push({ level: head.auth === 'public' ? publicLevel(key) : 'high', route: key, what: `auth is weaker: ${showAuth(base.auth)} → ${showAuth(head.auth)}` })
  } else if (rank(head.auth) > rank(base.auth)) {
    push({ level: 'info', route: key, what: `auth is stronger: ${showAuth(base.auth)} → ${showAuth(head.auth)}` })
  } else if (typeof head.auth === 'object' && typeof base.auth === 'object' && head.auth.permission !== base.auth.permission) {
    push({ level: 'medium', route: key, what: `permission changed: ${showAuth(base.auth)} → ${showAuth(head.auth)}` })
  }

  ownerRules(key, base, head, push)

  if (base !== undefined && base.load?.hash !== head.load?.hash) {
    push({ level: 'medium', route: key, what: head.load === null ? '`load` was removed' : base.load === null ? '`load` was added' : '`load` changed', ...(base.load !== null && { before: base.load.source }), ...(head.load !== null && { after: head.load.source }) })
  }

  const newResponse = Object.keys(head.response).filter((f) => base === undefined || !(f in base.response))
  for (const f of newResponse) {
    if (looksSecret(f)) push({ level: 'high', route: key, what: `response sends \`${f}\`, which looks like a secret` })
    else if (base !== undefined) push({ level: 'medium', route: key, what: `response sends a new field \`${f}\`` })
  }
  if (base !== undefined) {
    const gone = Object.keys(base.response).filter((f) => !(f in head.response))
    if (gone.length > 0) push({ level: 'info', route: key, what: `response no longer sends ${gone.map((f) => `\`${f}\``).join(', ')}` })
  }
  for (const source of ['body', 'query'] as const) {
    inputRules(key, source, Object.keys(head[source]).filter((f) => base === undefined || !(f in base[source])), push)
  }
  moneyAsNumber(key, base, head, push)

  if (base !== undefined) {
    if (base.usesUser === true && head.usesUser === false) push({ level: 'high', route: key, what: 'the handler no longer reads c.user' })
    if (base.handler !== head.handler) {
      push(head.responseIsList
        ? { level: 'medium', route: key, what: 'the handler of a list changed: check which rows it returns' }
        : { level: 'info', route: key, what: 'the handler changed (business logic is not checked)' })
    }
    if (base.rateLimit !== null && head.rateLimit === null) push({ level: 'medium', route: key, what: `rate limit removed (was ${base.rateLimit})` })
  }

  if (base === undefined && !out.some((c) => c.level === 'high' || c.level === 'medium')) {
    const owner = head.owner.kind === 'function' ? head.owner.source : head.owner.kind === 'missing' ? '-' : `'${head.owner.kind}'`
    const response = Object.keys(head.response)
    push({ level: 'ok', route: key, what: `new route: auth ${showAuth(head.auth)}, owner ${head.owner.kind === 'function' ? 'function' : owner}, sends ${response.length === 0 ? 'no fields' : response.map((f) => `\`${f}\``).join(', ')}`, ...(head.owner.kind === 'function' && { after: owner }) })
  }
  return out
}

export function diff(base: Manifest, head: Manifest): Change[] {
  const changes: Change[] = []
  const authFiles = new Set([...Object.keys(base.auth.files), ...Object.keys(head.auth.files)])
  const changedAuth = [...authFiles].filter((f) => base.auth.files[f] !== head.auth.files[f])
  if (changedAuth.length > 0 || JSON.stringify(base.auth.from) !== JSON.stringify(head.auth.from)) {
    changes.push({ level: 'high', what: `auth changed: ${changedAuth.length > 0 ? changedAuth.join(', ') : 'credential source'}; every route depends on it` })
  }
  for (const [key, head_] of Object.entries(head.routes)) changes.push(...routeChanges(key, base.routes[key], head_))
  for (const key of Object.keys(base.routes)) {
    if (!(key in head.routes)) changes.push({ level: 'info', route: key, what: 'route removed' })
  }
  const order: Record<Level, number> = { high: 0, medium: 1, ok: 2, info: 3 }
  return changes.sort((a, b) => order[a.level] - order[b.level])
}

// --------------------------------------------------------------- output

const ICON: Record<Level, string> = { high: '🔴', medium: '🟡', ok: '✓', info: 'ℹ' }
const TITLE: Record<Level, string> = { high: 'Needs review', medium: 'Look at', ok: 'New routes that follow the rules', info: 'Info' }

export function summary(changes: readonly Change[]): string {
  const n = (l: Level) => changes.filter((c) => c.level === l).length
  return `🔴 ${n('high')} need review · 🟡 ${n('medium')} to look at · ✓ ${n('ok')} new route(s) · ℹ ${n('info')} info`
}

export function formatDiff(changes: readonly Change[], format: 'text' | 'markdown'): string {
  if (changes.length === 0) return format === 'markdown' ? '## pangol security diff\n\nNo security-relevant changes.' : 'No security-relevant changes.'
  const lines: string[] = format === 'markdown' ? ['## pangol security diff', '', summary(changes)] : [summary(changes)]
  for (const level of ['high', 'medium', 'ok', 'info'] as const) {
    const list = changes.filter((c) => c.level === level)
    if (list.length === 0) continue
    lines.push('', format === 'markdown' ? `### ${ICON[level]} ${TITLE[level]}` : `${ICON[level]} ${TITLE[level]}`)
    for (const c of list) {
      const head = c.route === undefined ? c.what : format === 'markdown' ? `**${c.route}**: ${c.what}` : `${c.route}: ${c.what}`
      lines.push(format === 'markdown' ? `- ${head}` : `  ${head}`)
      if (c.before === undefined && c.after === undefined) continue
      if (format === 'markdown') {
        lines.push('  <details><summary>source</summary>', '')
        if (c.before !== undefined) lines.push('  before:', '  ```js', ...c.before.split('\n').map((l) => '  ' + l), '  ```')
        if (c.after !== undefined) lines.push(`  ${c.before === undefined ? 'source' : 'after'}:`, '  ```js', ...c.after.split('\n').map((l) => '  ' + l), '  ```')
        lines.push('  </details>')
      } else {
        if (c.before !== undefined) lines.push(`    before: ${c.before.replace(/\s+/g, ' ')}`)
        if (c.after !== undefined) lines.push(`    ${c.before === undefined ? 'source' : 'after '}: ${c.after.replace(/\s+/g, ' ')}`)
      }
    }
  }
  return lines.join('\n')
}

/** Exit code for --fail-on. */
export const failed = (changes: readonly Change[], failOn: 'high' | 'medium' | undefined) =>
  failOn !== undefined && changes.some((c) => c.level === 'high' || (failOn === 'medium' && c.level === 'medium'))
