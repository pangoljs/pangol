// The security manifest (SPEC section 10): what each route exposes, built from the route objects
// that were actually loaded. `pangol diff` compares two of them.
/// <reference types="node" />
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, sep } from 'node:path'
import type TS from 'typescript'
import { toDef, type SchemaDef } from '../runtime/def.js'
import { analyze } from './analyze.js'
import type { CheckResult } from './check.js'

export const MANIFEST_VERSION = 1

/** A function's source and a short hash of it. */
export interface Code { readonly source: string; readonly hash: string }
export type Uses = boolean | 'unknown'

export interface RouteManifest {
  readonly file: string
  readonly auth: string | { readonly permission: string }
  readonly owner:
    | { readonly kind: 'function'; readonly usesUser: Uses } & Code
    | { readonly kind: 'none' | 'query' | 'missing' }
  readonly load: Code | null
  /** field path -> schema kind, e.g. { "items[].id": "id", "price": "money?" } ("?" = optional) */
  readonly params: Readonly<Record<string, string>>
  readonly query: Readonly<Record<string, string>>
  readonly body: Readonly<Record<string, string>>
  readonly response: Readonly<Record<string, string>>
  readonly responseIsList: boolean
  readonly usesUser: Uses
  readonly rateLimit: string | null
  readonly handler: string
  /** Hashes of the project files this route imports (helpers an owner rule may call). */
  readonly imports: Readonly<Record<string, string>>
}

export interface Manifest {
  readonly pangol: typeof MANIFEST_VERSION
  /** The auth module and the project files it imports, by hash. */
  readonly auth: { readonly file: string | null; readonly from: unknown; readonly files: Readonly<Record<string, string>> }
  readonly routes: Readonly<Record<string, RouteManifest>>
}

const hash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16)
const code = (fn: unknown): Code => {
  const source = typeof fn === 'function' ? Function.prototype.toString.call(fn) : String(fn)
  return { source, hash: hash(source) }
}

/** Field paths of a schema: "title", "author.name", "tags[]", "items[].id". */
export function fieldPaths(schema: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (schema === undefined) return out
  const walk = (def: SchemaDef, path: string) => {
    if (def.kind === 'object') {
      for (const [name, field] of def.fields) {
        const at = path === '' ? name : `${path}.${name}`
        out[at] = field.kind + (field.optional || field.hasDefault ? '?' : '')
        walk(field, at)
      }
    } else if (def.kind === 'array') {
      const at = `${path}[]`
      if (def.item.kind !== 'object') out[at] = def.item.kind
      walk(def.item, at)
    }
  }
  walk(toDef(schema), '')
  return out
}

// Project files imported (transitively) by `file`: relative specifiers only, so packages are left out.
function localImports(ts: typeof TS, root: string, file: string): Record<string, string> {
  const out: Record<string, string> = {}
  const queue = [file]
  while (queue.length > 0) {
    const current = queue.pop() as string
    const text = readFileSync(join(root, current), 'utf8')
    if (current !== file) out[current] = hash(text)
    for (const { fileName } of ts.preProcessFile(text, true, true).importedFiles) {
      if (!fileName.startsWith('./') && !fileName.startsWith('../')) continue
      const base = normalize(join(dirname(current), fileName))
      const found = [base, base.replace(/\.(m?)js$/, '.$1ts'), `${base}.ts`, join(base, 'index.ts')]
        .map((f) => f.split(sep).join('/')).find((f) => existsSync(join(root, f)) && !f.startsWith('..'))
      if (found !== undefined && found !== file && !(found in out)) { out[found] = ''; queue.push(found) }
    }
  }
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => a.localeCompare(b)))
}

export function buildManifest(ts: typeof TS, root: string, result: CheckResult): Manifest {
  const routes: Record<string, RouteManifest> = {}
  for (const { key, file, definition: d } of result.routes) {
    const handler = d['handler'] as (...args: never[]) => unknown
    const a = analyze(ts, handler)
    const owner = d['owner']
    let ownerEntry: RouteManifest['owner']
    if (typeof owner === 'function') {
      const o = analyze(ts, owner as (...args: never[]) => unknown)
      ownerEntry = { kind: 'function', ...code(owner), usesUser: o.reads.has('user') ? true : o.escapes ? 'unknown' : false }
    } else {
      ownerEntry = { kind: owner === 'none' || owner === 'query' ? owner : 'missing' }
    }
    const auth = d['auth'] as RouteManifest['auth']
    routes[key] = {
      file,
      auth: typeof auth === 'object' ? { permission: auth.permission } : auth,
      owner: ownerEntry,
      load: d['load'] === undefined ? null : code(d['load']),
      params: fieldPaths(d['params']),
      query: fieldPaths(d['query']),
      body: fieldPaths(d['body']),
      response: fieldPaths(d['response']),
      responseIsList: d['response'] !== undefined && toDef(d['response']).kind === 'array',
      usesUser: a.reads.has('user') ? true : a.escapes ? 'unknown' : false,
      rateLimit: typeof d['rateLimit'] === 'string' ? d['rateLimit'] : null,
      handler: code(handler).hash,
      imports: localImports(ts, root, file),
    }
  }
  const authFile = result.authFile ?? null
  return {
    pangol: MANIFEST_VERSION,
    auth: {
      file: authFile,
      from: result.auth?.from ?? null,
      files: authFile === null ? {} : { [authFile]: hash(readFileSync(join(root, authFile), 'utf8')), ...localImports(ts, root, authFile) },
    },
    routes: Object.fromEntries(Object.entries(routes).sort(([a], [b]) => a.localeCompare(b))),
  }
}

