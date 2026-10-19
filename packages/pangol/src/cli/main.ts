#!/usr/bin/env node
/// <reference types="node" />
// The `pangol` command (SPEC section 13). Exit codes: 0 passed, 1 problems found, 2 wrong usage.
import { realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type TS from 'typescript'
import { canImportTypeScript, enableTypeScriptImports } from './load.js'

const USAGE = `Usage: pangol <command> [options]

Commands:
  check     check every route in src/routes (SPEC section 9)
  routes    check, then list each route with its auth and owner
  build     check, then write .pangol/routes.ts for createApp({ routes })

Options:
  --root <dir>      project folder (default: current folder)
  --routes <dir>    routes folder, relative to the root (default: src/routes)
  --auth <file>     auth module, relative to the root (default: src/auth.ts if it exists)
  --help, --version`

class UsageError extends Error {}

interface Args { command: string; root: string; routes?: string; auth?: string }

function parseArgs(argv: readonly string[]): Args | 'help' | 'version' {
  if (argv.includes('--help') || argv.includes('-h') || argv.length === 0) return 'help'
  if (argv.includes('--version')) return 'version'
  const [command = '', ...rest] = argv
  if (!['check', 'routes', 'build'].includes(command)) throw new UsageError(`unknown command "${command}"`)
  const args: Args = { command, root: process.cwd() }
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i] as string
    const value = rest[i + 1]
    if (!['--root', '--routes', '--auth'].includes(flag)) throw new UsageError(`unknown option "${flag}"`)
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${flag} needs a value`)
    if (flag === '--root') args.root = resolve(value)
    else if (flag === '--routes') args.routes = value
    else args.auth = value
    i++
  }
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
  const result = await check({ root: args.root, ts, ...(args.routes !== undefined && { routes: args.routes }), ...(args.auth !== undefined && { auth: args.auth }) })
  if (result.findings.length > 0) {
    err(formatFindings(result.findings))
    err(`\n${result.findings.length} problem(s) in ${result.routes.length} route(s).`)
    return 1
  }
  if (args.command === 'routes') {
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
