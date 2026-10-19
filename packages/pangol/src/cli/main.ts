#!/usr/bin/env node
/// <reference types="node" />
// The `pangol` command (SPEC section 13). Exit codes: 0 passed, 1 problems found, 2 wrong usage.
import { readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type TS from 'typescript'
import type { Manifest } from './manifest.js'
import { canImportTypeScript, enableTypeScriptImports } from './load.js'

const USAGE = `Usage: pangol <command> [options]

Commands:
  check [--manifest <file>]   check every route in src/routes (SPEC section 9); write the manifest
  routes                      check, then list each route with its auth and owner
  build                       check, then write .pangol/routes.ts for createApp({ routes })
  openapi                     check, then print an OpenAPI 3.1 document of every route (SPEC section 11)
  diff <base> [<head>]        security changes between two manifests (SPEC section 10):
                                diff base.json head.json   two manifest files
                                diff main                  git revision vs the working tree
                                diff main..HEAD            two git revisions

Options:
  --root <dir>                project folder (default: current folder)
  --routes <dir>              routes folder, relative to the root (default: src/routes)
  --auth <file>               auth module, relative to the root (default: src/auth.ts if it exists)
  --format text|markdown      diff output (default: text)
  --json <file>               also write the diff as JSON
  --fail-on high|medium       exit 1 when the diff has changes at this level or above
  --help, --version`

class UsageError extends Error {}

interface Args {
  command: string
  root: string
  positional: string[]
  routes?: string
  auth?: string
  manifest?: string
  format: 'text' | 'markdown'
  json?: string
  failOn?: 'high' | 'medium'
}

const FLAGS: Readonly<Record<string, readonly string[]>> = {
  check: ['--root', '--routes', '--auth', '--manifest'],
  routes: ['--root', '--routes', '--auth'],
  build: ['--root', '--routes', '--auth'],
  openapi: ['--root', '--routes', '--auth'],
  diff: ['--root', '--routes', '--auth', '--format', '--json', '--fail-on'],
}

function parseArgs(argv: readonly string[]): Args | 'help' | 'version' {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) return 'help'
  if (argv.includes('--version')) return 'version'
  const [command = '', ...rest] = argv
  const allowed = FLAGS[command]
  if (allowed === undefined) throw new UsageError(`unknown command "${command}"`)
  const args: Args = { command, root: process.cwd(), positional: [], format: 'text' }
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i] as string
    if (!flag.startsWith('--')) { args.positional.push(flag); continue }
    const value = rest[++i]
    if (!allowed.includes(flag)) throw new UsageError(`unknown option "${flag}" for ${command}`)
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`)
    if (flag === '--root') args.root = resolve(value)
    else if (flag === '--routes') args.routes = value
    else if (flag === '--auth') args.auth = value
    else if (flag === '--manifest') args.manifest = value
    else if (flag === '--json') args.json = value
    else if (flag === '--format') {
      if (value !== 'text' && value !== 'markdown') throw new UsageError('--format is text or markdown')
      args.format = value
    } else {
      if (value !== 'high' && value !== 'medium') throw new UsageError('--fail-on is high or medium')
      args.failOn = value
    }
  }
  const expected = command === 'diff' ? [1, 2] : [0]
  if (!expected.includes(args.positional.length)) throw new UsageError(command === 'diff' ? 'diff needs a base: a manifest file, a git revision, or base..head' : `${command} takes no arguments, got "${args.positional[0]}"`)
  return args
}

/** TypeScript from the project first (it is a peer dependency), else wherever pangol can find it. */
async function loadTypeScript(root: string): Promise<typeof TS> {
  try {
    const path = createRequire(join(root, 'package.json')).resolve('typescript')
    return ((await import(pathToFileURL(path).href)) as { default: typeof TS }).default
  } catch {
    try { return ((await import('typescript')) as { default: typeof TS }).default } catch {
      throw new UsageError('pangol check needs the typescript package: npm install -D typescript')
    }
  }
}

/** Title and version for the OpenAPI document, from the project's package.json. */
function projectInfo(root: string): { title: string; version: string } {
  try {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name?: unknown; version?: unknown }
    return { title: typeof pkg.name === 'string' ? pkg.name : 'API', version: typeof pkg.version === 'string' ? pkg.version : '0.0.0' }
  } catch { return { title: 'API', version: '0.0.0' } }
}

const authLabel = (a: unknown) => (typeof a === 'object' && a !== null ? `permission:${String((a as { permission?: unknown }).permission)}` : String(a))
const ownerLabel = (o: unknown) => (typeof o === 'function' ? 'function' : o === undefined ? '-' : String(o))

function table(rows: readonly (readonly string[])[]): string {
  const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length))) ?? []
  return rows.map((r) => r.map((cell, i) => (i === r.length - 1 ? cell : cell.padEnd(widths[i] ?? 0))).join('  ')).join('\n')
}

export async function main(argv: readonly string[], out = (s: string) => console.log(s), err = (s: string) => console.error(s)): Promise<number> {
  let args: ReturnType<typeof parseArgs>
  try { args = parseArgs(argv) } catch (e) {
    if (!(e instanceof UsageError)) throw e
    err(`pangol: ${e.message}\n\n${USAGE}`)
    return 2
  }
  if (args === 'help') { out(USAGE); return 0 }
  if (args === 'version') {
    const { version } = await import('../index.js')
    out(version)
    return 0
  }
  let ts: typeof TS
  try { ts = await loadTypeScript(args.root) } catch (e) { err(`pangol: ${(e as Error).message}`); return 2 }
  if (!canImportTypeScript()) err(`pangol: Node ${process.version} cannot import .ts files; use Node 22.18+ or Bun`)
  enableTypeScriptImports()
  const { check, formatFindings } = await import('./check.js')
  const { buildManifest } = await import('./manifest.js')
  const checkAt = (root: string) => check({ root, ts, ...(args.routes !== undefined && { routes: args.routes }), ...(args.auth !== undefined && { auth: args.auth }) })

  if (args.command === 'diff') {
    const { atRevision } = await import('./git.js')
    const { diff, failed, formatDiff } = await import('./diff.js')
    // A manifest of the project at `root`. Problems are reported, but the diff still shows what changed.
    const manifestAt = async (root: string, label: string) => {
      const result = await checkAt(root)
      if (result.findings.length > 0) err(`pangol: ${label} has ${result.findings.length} check problem(s); run pangol check there\n`)
      return buildManifest(ts, root, result)
    }
    const load = async (spec: string, label: string): Promise<Manifest> => {
      if (spec.endsWith('.json')) return JSON.parse(readFileSync(resolve(spec), 'utf8')) as Manifest
      return atRevision(args.root, spec, (root) => manifestAt(root, label))
    }
    const [first = '', second] = args.positional
    let base: Manifest, head: Manifest
    try {
      if (second !== undefined) [base, head] = [await load(first, first), await load(second, second)]
      else if (first.includes('..') && !first.endsWith('.json')) {
        const [from = '', to = ''] = first.split('..')
        ;[base, head] = [await load(from, from), await load(to || 'HEAD', to || 'HEAD')]
      } else [base, head] = [await load(first, first), await manifestAt(args.root, 'the working tree')]
    } catch (e) {
      err(`pangol: ${e instanceof Error ? e.message : String(e)}`)
      return 2
    }
    const changes = diff(base, head)
    out(formatDiff(changes, args.format))
    if (args.json !== undefined) writeFileSync(args.json, JSON.stringify(changes, null, 2) + '\n')
    return failed(changes, args.failOn) ? 1 : 0
  }

  const result = await checkAt(args.root)
  if (args.manifest !== undefined) writeFileSync(args.manifest, JSON.stringify(buildManifest(ts, args.root, result), null, 2) + '\n')
  if (result.findings.length > 0) {
    err(formatFindings(result.findings))
    err(`\n${result.findings.length} problem(s) in ${result.routes.length} route(s).`)
    return 1
  }
  if (args.command === 'openapi') {
    const { openApi } = await import('./openapi.js')
    out(JSON.stringify(openApi(result, ts, projectInfo(args.root)), null, 2))
  } else if (args.command === 'routes') {
    out(table([['ROUTE', 'AUTH', 'OWNER', 'FILE'], ...result.routes.map((r) => [r.key, authLabel(r.definition['auth']), ownerLabel(r.definition['owner']), r.file])]))
  } else if (args.command === 'build') {
    const { importExtension, writeRoutes } = await import('./build.js')
    const file = writeRoutes(args.root, result, importExtension(ts, args.root))
    out(`✓ ${result.routes.length} route(s) checked; wrote ${file}`)
  } else {
    out(`✓ ${result.routes.length} route(s) checked, no problems.`)
  }
  return 0
}

// Run when executed as the `pangol` binary (often through a node_modules/.bin symlink), not when imported.
const entry = process.argv[1]
if (entry !== undefined && import.meta.url === pathToFileURL(realpathSync(entry)).href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code }, (e: unknown) => {
    console.error(e)
    process.exitCode = 1
  })
}
