// createApp: checks every route when the app starts, then runs each request through the fixed
// pipeline of SPEC section 3. Steps that are synchronous stay synchronous: a Promise is only
// created when resolve, load, owner, the handler or the body read is async.
import type { AuthDefinition, AuthRequest, User } from '../auth.js'
import { Reject, checkPath, decodeUtf8, isJson, parseJson, pathFromUrl, safeSegment } from '../core/strict.js'
import { Schema } from '../schema.js'
import { toDef } from './def.js'
import { compileCors, type CorsOptions } from './cors.js'
import { bearerToken, cookieCredential, parseCookies, sameOriginOrAllowed } from './credentials.js'
import { createLimiter, type Limiter } from './ratelimit.js'
import { Router, type Method } from './router.js'
import { ResponseError, compileSerializer } from './serialize.js'
import { ValidationError, compileValidator } from './validate.js'

export type RouteKey = `${Method} /${string}`

export interface AppOptions {
  readonly auth?: AuthDefinition<User>
  /** `'GET /posts/:id': route({...})`. File-based routing generates this table. */
  readonly routes: Readonly<Record<RouteKey, object>>
  /**
   * Browser apps on other origins that may call this API: they get CORS headers, and cookie auth
   * trusts them for writes (SPEC section 12). Off when left out.
   */
  readonly cors?: CorsOptions
  readonly limits?: { readonly body?: number }
  /** Server-side log for 500s; details never reach the client. Default: console.error. */
  readonly log?: (message: string) => void
}

export interface RequestInfo {
  /** Client address, used as the rate limit key. The adapter supplies it. */
  readonly ip?: string
}

export interface App {
  fetch(request: Request, info?: RequestInfo): Promise<Response>
  readonly limits: { readonly body: number }
}

// ---------------------------------------------------------------- responses

export class Out {
  constructor(
    readonly status: number,
    readonly body: string | null,
    readonly allow?: string,
    /** Replaces the default headers (CORS); built at startup, so sending never merges. */
    readonly headers?: Readonly<Record<string, string>>,
  ) {}
}
const error = (status: number, message: string, field?: string) =>
  new Out(status, JSON.stringify(field === undefined ? { error: message } : { error: message, field }))
const NOT_FOUND = error(404, 'not found')
const UNAUTHORIZED = error(401, 'unauthorized')
const FORBIDDEN = error(403, 'forbidden')
const INTERNAL = error(500, 'internal error')
const NO_CONTENT = new Out(204, null)

export const SECURITY_HEADERS = { 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'cache-control': 'no-store' }
export const JSON_HEADERS = { ...SECURITY_HEADERS, 'content-type': 'application/json' }
/** The headers to send with `out`, for every adapter. */
export function headersOf(out: Out): Readonly<Record<string, string>> {
  const headers = out.headers ?? (out.body === null ? SECURITY_HEADERS : JSON_HEADERS)
  return out.allow === undefined ? headers : { ...headers, allow: out.allow }
}
const toResponse = (out: Out) => new Response(out.body, { status: out.status, headers: headersOf(out) })

// What c.fail / c.created / c.noContent return. The symbol is private, so a handler cannot forge one.
const RESULT = Symbol('pangol.result')
type Result =
  | { readonly [RESULT]: 'failure'; readonly status: unknown; readonly message: unknown }
  | { readonly [RESULT]: 'created'; readonly value: unknown }
  | { readonly [RESULT]: 'noContent' }
const NO_CONTENT_RESULT: Result = Object.freeze({ [RESULT]: 'noContent' as const })
const helpers = {
  fail: (status: unknown, message: unknown): Result => ({ [RESULT]: 'failure', status, message }),
  created: (value: unknown): Result => ({ [RESULT]: 'created', value }),
  noContent: (): Result => NO_CONTENT_RESULT,
}
const isResult = (v: unknown): v is Result => typeof v === 'object' && v !== null && RESULT in v
// Must match FailStatus in route.ts.
const FAIL_STATUS = new Set([400, 401, 402, 403, 404, 405, 406, 407, 408, 409, 410, 411, 412, 413, 414, 415, 416, 417, 421, 422, 423, 424, 425, 426, 428, 429, 431, 451])

// ---------------------------------------------------------------- maybe-async steps

type Step = Out | Promise<Out>
const isThenable = (v: unknown): v is PromiseLike<unknown> =>
  (typeof v === 'object' || typeof v === 'function') && v !== null && typeof (v as { then?: unknown }).then === 'function'
const then = (v: unknown, next: (value: unknown) => Step): Step => (isThenable(v) ? Promise.resolve(v).then(next) : next(v))

// ---------------------------------------------------------------- startup checks

const OPTIONS = ['auth', 'params', 'query', 'body', 'response', 'handler', 'load', 'owner', 'rateLimit', 'description']
const KEY = /^(GET|POST|PUT|PATCH|DELETE) (\/\S*)$/
const PARAM = /^:[A-Za-z_][A-Za-z0-9_]*$/

function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min((row[j] ?? 0) + 1, (next[j - 1] ?? 0) + 1, (row[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length] ?? 0
}
const suggest = (name: string) => OPTIONS.map((o) => [o, distance(name, o)] as const).sort((x, y) => x[1] - y[1]).find(([, d]) => d <= 3)?.[0]

type Definition = Readonly<Record<string, unknown>>
type AuthMode = 'public' | 'optional' | 'user' | { readonly permission: string }
const isAuthMode = (a: unknown): a is AuthMode => a === 'public' || a === 'optional' || a === 'user' ||
  (typeof a === 'object' && a !== null && typeof (a as { permission?: unknown }).permission === 'string' &&
    (a as { permission: string }).permission !== '' && Object.keys(a).length === 1)
const fn = (v: unknown): v is (...args: never[]) => unknown => typeof v === 'function'

interface Compiled {
  readonly key: string
  readonly auth: AuthMode
  readonly names: readonly string[]
  readonly params?: (v: unknown) => unknown
  readonly query?: (v: unknown) => unknown
  readonly body?: (v: unknown) => unknown
  readonly empty: boolean
  readonly serialize: (v: unknown) => string
  readonly load?: (c: Context) => unknown
  readonly owner?: (c: Context, record: unknown) => unknown
  readonly handler: (c: Context) => unknown
  readonly limiter?: Limiter
}

/** A startup check that failed. `key` is the route it belongs to, if any. */
export interface Problem { readonly key?: string; readonly what: string; readonly fix: string; readonly rule?: string }
const format = (p: Problem) => `✖ ${p.key === undefined ? '' : p.key + ': '}${p.what}\n    Fix: ${p.fix}`

function compileRoute(key: string, def: Definition, hasAuth: boolean, problems: Problem[]): { method: Method; path: string; route: Compiled } | null {
  const before = problems.length
  // `rule` is the check number of SPEC section 9
  const problem = (what: string, fix: string, rule?: string) => problems.push({ key, what, fix, ...(rule !== undefined && { rule }) })
  const m = KEY.exec(key)
  if (m === null) { problem('a route key is "<METHOD> <path>"', "use e.g. 'GET /posts/:id' with GET, POST, PUT, PATCH or DELETE", 'C14'); return null }
  const method = m[1] as Method, path = m[2] as string
  const segments = path.split('/').slice(1)
  if (checkPath(path) === null || segments.some((s) => s.startsWith(':') && !PARAM.test(s))) {
    problem('the path is not canonical', 'no trailing slash, no empty, "." or ".." segments; params look like :id', 'C14')
    return null
  }
  const names = segments.filter((s) => s.startsWith(':')).map((s) => s.slice(1))

  for (const option of Object.keys(def)) {
    if (!OPTIONS.includes(option)) { const s = suggest(option); problem(`unknown option \`${option}\``, s ? `did you mean \`${s}\`?` : `options are ${OPTIONS.join(', ')}`, 'C12') }
  }
  const { auth, params, query, body, response, handler, load, owner, rateLimit } = def
  if (!isAuthMode(auth)) problem('`auth` is missing or invalid', "auth: 'public' | 'optional' | 'user' | { permission: 'name' }", 'C1')
  else if (auth !== 'public' && !hasAuth) problem(`auth '${typeof auth === 'object' ? 'permission' : auth}' needs the app's auth`, 'pass auth: defineAuth({ from, resolve }) to createApp', 'C14')
  if (!fn(handler)) problem('`handler` must be a function', 'handler: (c) => value')
  if (!(response instanceof Schema)) problem('`response` is missing', 'response: t.object({ ...fields the client may see }) or t.empty()', 'C2')
  if ((method === 'GET' || method === 'DELETE') && body !== undefined) problem(`${method} routes cannot have a \`body\``, 'move the fields to `query`, or use POST/PUT/PATCH', 'C5')
  if (params instanceof Schema && params.kind === 'object') {
    const declared = Object.keys(params.options['properties'] ?? {})
    if (declared.length !== names.length || !names.every((n) => declared.includes(n))) {
      problem(`\`params\` (${declared.join(', ') || 'none'}) must match the path (${names.join(', ') || 'none'})`, `params: t.object({ ${names.map((n) => `${n}: t.id()`).join(', ')} })`, 'C4')
    }
  }
  if (load !== undefined && !fn(load)) problem('`load` must be a function', 'load: (c) => db.things.get(c.params.id)')
  if (owner !== undefined && !fn(owner) && owner !== 'none' && owner !== 'query') problem('`owner` is invalid', "owner: (c, record) => boolean, 'none' or 'query'")
  if (fn(owner) && !fn(load)) problem('an owner function needs `load`', 'add load: (c) => db.things.get(c.params.id)', 'C6')
  if (fn(owner) && auth === 'public') problem('an owner rule on a public route has no user to check', "use auth: 'user' or 'optional'", 'C6')
  if (names.length > 0 && auth !== 'public' && owner === undefined) {
    problem(`acts on a specific record (${names.map((n) => ':' + n).join(', ')}) but has no \`owner\` rule`,
      "add load: (c) => db.things.get(c.params.id) and owner: (c, thing) => thing.ownerId === c.user.id; or owner: 'none' / 'query'", 'C6')
  }
  const compiled: { -readonly [K in keyof Compiled]?: Compiled[K] } = {}
  try {
    if (params !== undefined) compiled.params = compileValidator(params, 'params')
    if (query !== undefined) compiled.query = compileValidator(query, 'query')
    if (body !== undefined) compiled.body = compileValidator(body, 'body')
    if (rateLimit !== undefined) compiled.limiter = createLimiter(rateLimit as string)
    if (response instanceof Schema) compiled.serialize = compileSerializer(response)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    problem(message, 'see SPEC sections 5 and 6', message.includes('.private()') ? 'C10' : undefined)
  }
  if (fn(load)) compiled.load = load as NonNullable<Compiled['load']>
  if (fn(owner)) compiled.owner = owner as NonNullable<Compiled['owner']>
  if (problems.length > before) return null
  const empty = response instanceof Schema && toDef(response).kind === 'empty'
  const route = { ...compiled, key, auth: auth as AuthMode, names, handler: handler as Compiled['handler'], empty } as Compiled
  return { method, path, route }
}

// ---------------------------------------------------------------- the request

/** One request as an adapter describes it. `headers` may be built lazily (only when a handler reads c.headers). */
export interface Incoming {
  readonly method: string
  readonly target: string
  readonly query: string
  readonly host: string
  readonly ip: string
  readonly headers: Headers
  readonly header: (name: string) => string | null
  readonly readBody: (limit: number) => Promise<Uint8Array>
}

interface Context {
  params: unknown; query: unknown; body: unknown; resource: unknown
  readonly user: User | null; readonly ip: string; readonly headers: Headers
  readonly fail: typeof helpers.fail; readonly created: typeof helpers.created; readonly noContent: typeof helpers.noContent
}

function parseQuery(qs: string): Record<string, string> {
  const out: Record<string, string> = Object.create(null)
  if (qs === '') return out
  const pairs = qs.split('&')
  if (pairs.length > 100) throw new ValidationError('query', 'has too many parameters')
  const decode = (s: string) => {
    try { return decodeURIComponent(s.replaceAll('+', ' ')) } catch { throw new ValidationError('query', 'is not valid percent-encoded UTF-8') }
  }
  for (const pair of pairs) {
    if (pair === '') continue
    const eq = pair.indexOf('=')
    const name = decode(eq === -1 ? pair : pair.slice(0, eq))
    if (name in out) throw new ValidationError(`query.${name}`, 'is repeated')
    out[name] = eq === -1 ? '' : decode(pair.slice(eq + 1))
  }
  return out
}

const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Every startup check, without starting anything: createApp throws on these, `pangol check` reports them.
function compileApp(options: AppOptions) {
  const { auth, routes } = options
  const router = new Router<Compiled>()
  const problems: Problem[] = []
  const cors = options.cors === undefined ? undefined
    : compileCors(options.cors, auth !== undefined && auth.from !== 'bearer', { json: JSON_HEADERS, empty: SECURITY_HEADERS }, problems)
  for (const [key, def] of Object.entries(routes)) {
    const r = compileRoute(key, def as Definition, auth !== undefined, problems)
    if (r !== null && !router.add(r.method, r.path, r.route)) problems.push({ key, what: 'the same method and path is defined twice', fix: 'remove or rename one of them', rule: 'C14' })
  }
  return { router, problems, cors }
}

/** The problems that would stop createApp(options), as data. */
export const findProblems = (options: AppOptions): readonly Problem[] => compileApp(options).problems

export function createApp(options: AppOptions): App {
  const { auth, limits = {}, log = (m: string) => console.error(m) } = options
  const bodyLimit = limits.body ?? 1024 * 1024
  const { router, problems, cors } = compileApp(options)
  if (problems.length > 0) throw new Error(`pangol: ${problems.length} problem(s), the app was not started.\n${problems.map(format).join('\n')}`)
  const trusted = cors?.origins ?? new Set<string>()

  const fail = (route: Compiled, e: unknown): Out => {
    if (e instanceof ValidationError) return error(400, `${e.field} ${e.message}`, e.field)
    if (e instanceof Reject) return error(e.status, e.code)
    if (e instanceof ResponseError) log(`[pangol] ${route.key}: the handler returned a value that does not match \`response\`: ${e.path} ${e.message}`)
    else log(`[pangol] ${route.key}: ${e instanceof Error ? e.stack ?? e.message : String(e)}`)
    return INTERNAL
  }

  function authenticate(route: Compiled, req: Incoming): User | null | Out | Promise<User | null | Out> {
    if (route.auth === 'public' || auth === undefined) return null
    const cookies = parseCookies(req.header('cookie'))
    const from = auth.from
    const credential = from === 'bearer' ? bearerToken(req.header('authorization')) : cookieCredential(cookies, from.cookie)
    if (credential === null) return UNAUTHORIZED
    if (credential === undefined) return route.auth === 'optional' ? null : UNAUTHORIZED
    if (from !== 'bearer' && UNSAFE.has(req.method) && !sameOriginOrAllowed(req.header, req.host, trusted)) return error(403, 'cross-origin request blocked')
    const request: AuthRequest = {
      method: req.method, url: req.target, credential,
      headers: { get: (name) => req.header(name) },
      cookies: { get: (name) => cookies.get(name) ?? undefined },
    }
    const check = (u: unknown): User | Out => {
      if (u === null || u === undefined) return UNAUTHORIZED
      if (typeof u !== 'object' || typeof (u as User).id !== 'string' || !Array.isArray((u as User).permissions)) {
        log(`[pangol] ${route.key}: auth.resolve must return { id: string, permissions: string[] } or null`)
        return INTERNAL
      }
      const required = route.auth
      return typeof required === 'object' && !(u as User).permissions.includes(required.permission) ? FORBIDDEN : u as User
    }
    const user = auth.resolve(request) // awaited when it is a Promise: a pending Promise is not a user (audit C3)
    return isThenable(user) ? Promise.resolve(user).then(check) : check(user)
  }

  function finish(route: Compiled, out: unknown): Out {
    if (isResult(out)) {
      if (out[RESULT] === 'failure') {
        if (typeof out.status === 'number' && FAIL_STATUS.has(out.status)) return error(out.status, String(out.message))
        log(`[pangol] ${route.key}: c.fail(${String(out.status)}) is not a 4xx status; throw for server errors`)
        return INTERNAL
      }
      if (out[RESULT] === 'noContent') {
        if (route.empty) return NO_CONTENT
        log(`[pangol] ${route.key}: c.noContent() needs response: t.empty()`)
        return INTERNAL
      }
      if (!route.empty) return new Out(201, route.serialize(out.value))
    }
    if (route.empty) { log(`[pangol] ${route.key}: response is t.empty(), so the handler must return c.noContent()`); return INTERNAL }
    return new Out(200, route.serialize(out))
  }

  function afterInput(route: Compiled, c: Context): Step {
    const handle = () => then(route.handler(c), (out) => finish(route, out))
    if (route.load === undefined) return handle()
    return then(route.load(c), (record) => {
      if (record === null || record === undefined) return NOT_FOUND
      const accept = () => { c.resource = record; return handle() }
      if (route.owner === undefined) return accept()
      // not the owner -> 404 like a missing record, so callers cannot learn which ids exist
      return then(route.owner(c, record), (allowed) => (allowed === true ? accept() : NOT_FOUND))
    })
  }

  function afterAuth(route: Compiled, req: Incoming, values: readonly string[], user: User | null): Step {
    if (route.limiter !== undefined && !route.limiter.hit(`${req.ip}|${user?.id ?? ''}`)) return error(429, 'too many requests')
    const raw: Record<string, string> = {}
    route.names.forEach((name, i) => {
      let v: string
      try { v = decodeURIComponent(values[i] ?? '') } catch { throw new ValidationError(`params.${name}`, 'is invalid') }
      if (!safeSegment(v) || v.length > 200) throw new ValidationError(`params.${name}`, 'is invalid')
      raw[name] = v
    })
    const c: Context = {
      params: route.params ? route.params(raw) : raw, query: undefined, body: undefined, resource: undefined,
      user, ip: req.ip, get headers() { return req.headers }, ...helpers,
    }
    if (route.query) c.query = route.query(parseQuery(req.query))
    if (route.body === undefined) return afterInput(route, c)
    if (!isJson(req.header('content-type'))) return error(415, 'expected application/json')
    const validate = route.body
    return req.readBody(bodyLimit).then((bytes) => {
      c.body = validate(parseJson(decodeUtf8(bytes)))
      return afterInput(route, c)
    })
  }

  function run(route: Compiled, req: Incoming, values: readonly string[]): Step {
    try {
      const user = authenticate(route, req)
      const out = then(user, (u) => (u instanceof Out ? u : afterAuth(route, req, values, u as User | null)))
      return isThenable(out) ? out.then(undefined, (e: unknown) => fail(route, e)) : out
    } catch (e) {
      return fail(route, e)
    }
  }

  // Steps 1-2 (strict path, routing), then the route's pipeline. `url` is the request-target as the
  // adapter received it: origin-form ("/a?b") from node:http, absolute-form from fetch runtimes.
  const dispatch: Handle = (method, url, header, incoming) => {
    const path = pathFromUrl(url)
    if (path === null) return BAD_PATH
    const found = router.find(method, path)
    if (found === null) return NOT_FOUND
    if ('allow' in found) {
      if (cors !== undefined && method === 'OPTIONS' && header('access-control-request-method') !== null) {
        const headers = cors.preflight(header('origin'), found.allow)
        return headers === null ? CORS_BLOCKED : new Out(204, null, undefined, headers)
      }
      return new Out(405, METHOD_NOT_ALLOWED, found.allow)
    }
    const q = url.indexOf('?')
    const query = q === -1 ? '' : url.slice(q + 1)
    return run(found.route, incoming(query === '' ? path : `${path}?${query}`, query), found.values)
  }

  const withCors = (origin: string | null) => (out: Out) =>
    out.headers !== undefined || cors === undefined ? out : new Out(out.status, out.body, out.allow, cors.response(origin, out.body === null))
  const handle: Handle = cors === undefined ? dispatch : (method, url, header, incoming) => {
    const out = dispatch(method, url, header, incoming)
    const decorate = withCors(header('origin'))
    return isThenable(out) ? out.then(decorate) : decorate(out)
  }

  const app: App = {
    limits: Object.freeze({ body: bodyLimit }),
    fetch(request, info = {}) {
      const url = request.url
      const header = (name: string) => request.headers.get(name)
      const out = handle(request.method, url, header, (target, query) => ({
        method: request.method, target, query,
        host: request.headers.get('host') ?? new URL(url).host, ip: info.ip ?? '',
        headers: request.headers, header, readBody: (limit) => readBody(request, limit),
      }))
      return isThenable(out) ? out.then(toResponse) : Promise.resolve(toResponse(out))
    },
  }
  handlers.set(app, handle)
  return app
}

export type Handle = (method: string, url: string, header: (name: string) => string | null, incoming: (target: string, query: string) => Incoming) => Out | Promise<Out>
const handlers = new WeakMap<App, Handle>()
const BAD_PATH = error(400, 'invalid path')
const CORS_BLOCKED = error(403, 'origin not allowed')
const METHOD_NOT_ALLOWED = JSON.stringify({ error: 'method not allowed' })

/** For adapters in this package: the app's request handler without the fetch Request/Response wrapping. */
export function handlerOf(app: App): Handle {
  const handle = handlers.get(app)
  if (handle === undefined) throw new TypeError('expected an app from createApp()')
  return handle
}

async function readBody(request: Request, limit: number): Promise<Uint8Array> {
  const length = request.headers.get('content-length')
  if (length !== null) {
    if (!/^[0-9]{1,15}$/.test(length)) throw new Reject(400, 'bad_content_length')
    if (Number(length) > limit) throw new Reject(413, 'body_too_large')
  }
  if (request.body === null) return new Uint8Array(0)
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) { await reader.cancel(); throw new Reject(413, 'body_too_large') } // stop reading at once
    chunks.push(value)
  }
  if (chunks.length === 1) return chunks[0] as Uint8Array
  const out = new Uint8Array(size)
  let at = 0
  for (const chunk of chunks) { out.set(chunk, at); at += chunk.byteLength }
  return out
}
