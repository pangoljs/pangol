#!/usr/bin/env node
import { readFileSync } from 'node:fs'
import { createInterface } from 'node:readline/promises'
import { createProject, runtimeOf, UsageError, type Runtime } from './scaffold.js'

const USAGE = 'Usage: create-pangol [directory] [--runtime node|bun]\n\nCreates a project without installing dependencies.\nNon-interactive use requires directory and --runtime.\nOptions: --help, --version'

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 1 && (args[0] === '--help' || args[0] === '-h')) { console.log(USAGE); return }
  if (args.length === 1 && args[0] === '--version') {
    console.log((JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version)
    return
  }
  let directory: string | undefined, runtime: Runtime | undefined
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] as string
    if (arg === '--runtime' && runtime === undefined) runtime = runtimeOf(args[++i] ?? '')
    else if (!arg.startsWith('-') && directory === undefined) directory = arg
    else throw new UsageError(`unexpected argument: ${arg}`)
  }
  if (directory === undefined || runtime === undefined) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new UsageError('provide directory and --runtime node|bun in non-interactive mode')
    const prompt = createInterface({ input: process.stdin, output: process.stdout })
    try {
      directory ??= (await prompt.question('Project folder (my-api): ')).trim() || 'my-api'
      runtime ??= runtimeOf((await prompt.question('Runtime (node/bun, default node): ')).trim() || 'node')
    } finally { prompt.close() }
  }
  const target = createProject(directory, runtime)
  // Quote the whole directory as one shell argument, including parent folder names.
  const quotedDirectory = "'" + directory.replaceAll("'", "'\\''") + "'"
  console.log(`Created ${target}\n\nNext:\n  cd ${quotedDirectory}\n  npm install\n  npm run test\n  npm run dev\n\nConnect src/auth.ts to your session provider to enable authenticated routes.`)
}

main().catch((error: unknown) => {
  console.error(`create-pangol: ${error instanceof Error ? error.message : String(error)}`)
  if (error instanceof UsageError) console.error(USAGE)
  process.exitCode = error instanceof UsageError ? 2 : 1
})
