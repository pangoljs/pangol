// `pangol check` (SPEC section 9): load every route file the way the app will, run the startup
// checks of createApp, then the rules that need the handler's AST. Nothing is started or served.
/// <reference types="node" />
import { existsSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import type TS from 'typescript'
import type { AuthDefinition, User } from '../auth.js'
import { findProblems, type RouteKey } from '../runtime/app.js'
import { Schema } from '../schema.js'
import { analyze } from './analyze.js'
import { routeFromFile } from './files.js'

export interface CheckOptions {
  /** Project folder; paths in findings are relative to it. */
  readonly root: string
  /** Default 'src/routes'. */
  readonly routes?: string
  /** Default 'src/auth.ts' (or .js), when it exists. */
  readonly auth?: string
  readonly ts: typeof TS
}

export interface Finding {
  readonly file?: string
  readonly key?: string
  /** The check number of SPEC section 9, e.g. 'C6'. */
  readonly rule?: string
  readonly what: string
  readonly fix: string
}

export interface LoadedRoute {
  readonly key: RouteKey
  readonly file: string
  readonly definition: Readonly<Record<string, unknown>>
}

export interface CheckResult {
  readonly findings: readonly Finding[]
  readonly routes: readonly LoadedRoute[]
  readonly auth?: AuthDefinition<User>
  readonly authFile?: string
}

const posix = (path: string) => path.split(sep).join('/')
const message = (e: unknown) => (e instanceof Error ? e.message : String(e))

export async function check(options: CheckOptions): Promise<CheckResult> {
  const { root, ts } = options
  const routesDir = options.routes ?? 'src/routes'
  const findings: Finding[] = []
  const routes: LoadedRoute[] = []
  const byKey = new Map<string, LoadedRoute>()

  const dir = join(root, routesDir)
  if (!existsSync(dir)) {
    return { findings: [{ file: routesDir, what: 'the routes folder does not exist', fix: `create ${routesDir}/ with one file per route, e.g. ${routesDir}/health.get.ts` }], routes }
  }
  const files = readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((d) => d.isFile())
    .map((d) => posix(relative(dir, join(d.parentPath, d.name))))
    .sort()

  for (const name of files) {
    const file = `${posix(routesDir)}/${name}`
    const parsed = routeFromFile(name)
    if (parsed.kind === 'skip') continue
    if (parsed.kind === 'error') { findings.push({ file, rule: 'C14', what: `${name} ${parsed.what}`, fix: parsed.fix }); continue }
    const key = parsed.key as RouteKey
    const taken = byKey.get(key)
    if (taken !== undefined) { findings.push({ file, key, rule: 'C14', what: `${key} is also ${taken.file}`, fix: 'keep one file per method and path' }); continue }
    let mod: { default?: unknown }
    try { mod = await import(pathToFileURL(join(dir, name)).href) as { default?: unknown } } catch (e) {
      findings.push({ file, key, rule: 'C14', what: `could not be loaded: ${message(e)}`, fix: 'a route file must load without side effects that can fail; connect to services lazily' })
      continue
    }
    if (typeof mod.default !== 'object' || mod.default === null) {
      findings.push({ file, key, rule: 'C14', what: 'has no default export', fix: 'export default route({ auth, response, handler })' })
      continue
    }
    const route: LoadedRoute = { key, file, definition: mod.default as Readonly<Record<string, unknown>> }
    byKey.set(key, route)
    routes.push(route)
  }

  const authFile = options.auth ?? ['src/auth.ts', 'src/auth.mts', 'src/auth.js', 'src/auth.mjs'].find((f) => existsSync(join(root, f)))
  let auth: AuthDefinition<User> | undefined
  if (authFile !== undefined) {
    try {
      const mod = await import(pathToFileURL(join(root, authFile)).href) as { default?: unknown; auth?: unknown }
      auth = (mod.default ?? mod.auth) as AuthDefinition<User> | undefined
      if (auth === undefined) findings.push({ file: authFile, rule: 'C14', what: 'exports no auth', fix: 'export default defineAuth({ from, resolve })' })
    } catch (e) {
      findings.push({ file: authFile, rule: 'C14', what: `could not be loaded: ${message(e)}`, fix: 'auth.ts must load without side effects that can fail' })
    }
  }

  const table = Object.fromEntries(routes.map((r) => [r.key, r.definition])) as Record<RouteKey, object>
  for (const p of findProblems({ ...(auth !== undefined && { auth }), routes: table })) {
    const route = p.key === undefined ? undefined : byKey.get(p.key)
    const noAuth = p.what.includes("needs the app's auth")
    findings.push({
      ...(route !== undefined && { file: route.file, key: route.key }), ...(p.rule !== undefined && { rule: p.rule }),
      what: p.what, fix: noAuth ? 'create src/auth.ts with export default defineAuth({ from, resolve })' : p.fix,
    })
  }
  for (const route of routes) findings.push(...handlerRules(ts, route))
  return { findings, routes, ...(auth !== undefined && { auth }), ...(authFile !== undefined && { authFile }) }
}

// C3, C7, C8, C9 and C13: rules about what the handler does, from its AST.
function handlerRules(ts: typeof TS, { key, file, definition: d }: LoadedRoute): Finding[] {
  if (typeof d['handler'] !== 'function') return []
  const a = analyze(ts, d['handler'] as (...args: never[]) => unknown)
  const out: Finding[] = []
  const finding = (rule: string, what: string, fix: string) => out.push({ file, key, rule, what, fix })
  for (const input of ['body', 'query'] as const) {
    if (a.reads.has(input) && d[input] === undefined) finding('C3', `the handler reads c.${input} but the route declares no \`${input}\` schema`, `add ${input}: t.object({ ...the fields it reads })`)
  }
  if (d['load'] !== undefined && !a.escapes && !a.reads.has('resource')) {
    finding('C7', 'has `load` but the handler never uses c.resource', 'use c.resource (the record that passed `owner`) instead of fetching again with c.params')
  }
  if (d['owner'] === 'none' && a.failStatuses.includes(403)) {
    finding('C8', "has owner: 'none' but the handler answers 403 itself", 'move the rule into owner: (c, record) => ... (failures answer 404)')
  }
  if (d['auth'] === 'public' && a.reads.has('user')) {
    finding('C9', "is auth: 'public' but the handler reads c.user, which is always null there", "use auth: 'optional' (signed-in users get c.user) or 'user'")
  }
  const response = d['response']
  if (response instanceof Schema && response.kind === 'empty' && !a.escapes && !a.reads.has('noContent')) {
    finding('C13', 'has response: t.empty() but the handler never calls c.noContent()', 'return c.noContent()')
  }
  return out
}

/** Findings as text, grouped by file (SPEC section 9). */
export function formatFindings(findings: readonly Finding[]): string {
  const groups = new Map<string, Finding[]>()
  for (const f of findings) {
    const at = f.file ?? 'app'
    groups.set(at, [...(groups.get(at) ?? []), f])
  }
  return [...groups].map(([file, list]) => `✖ ${file}\n` + list.map((f) =>
    `  ${f.key === undefined ? '' : f.key + ' '}${f.what}${f.rule === undefined ? '' : ` (${f.rule})`}\n    Fix: ${f.fix}`).join('\n')).join('\n\n')
}
