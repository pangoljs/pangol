// `npm run check` for both kinds of projects. Prints the result for the agent and appends a
// record to logs/<run>/checks.jsonl (outside the agent's workspace) for scoring.
// usage (from a task folder): node ../tools/check.mjs <hyper|hono>
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const kind = process.argv[2]
const taskDir = process.cwd()
const root = '..'
const run = path.basename(path.dirname(taskDir))
const task = path.basename(taskDir)

let r
if (kind === 'hyper') {
  r = spawnSync('node', [path.join(root, 'hyperflat/cli.mjs'), 'check'], { cwd: taskDir, encoding: 'utf8', timeout: 30_000 })
} else {
  // Hono: the app must load and export a Hono app; list its routes.
  const probe = `import('${path.join(taskDir, 'src/app.js')}').then((m) => {
    const app = m.default
    if (!app || typeof app.fetch !== 'function') { console.error('✖ src/app.js must \`export default\` a Hono app'); process.exit(1) }
    const routes = (app.routes ?? []).filter((x) => x.method !== 'ALL')
    console.log('✔ app loaded, ' + routes.length + ' route handlers')
    for (const x of routes) console.log('  ' + x.method.padEnd(6) + ' ' + x.path)
  }).catch((e) => { console.error('✖ ' + (e.stack ?? e).split('\\n').slice(0, 4).join('\\n')); process.exit(1) })`
  r = spawnSync('node', ['--input-type=module', '-e', probe], { cwd: taskDir, encoding: 'utf8', timeout: 30_000 })
}
process.stdout.write(r.stdout ?? '')
process.stderr.write(r.stderr ?? '')
const logDir = path.join(root, 'logs', run)
fs.mkdirSync(logDir, { recursive: true })
fs.appendFileSync(path.join(logDir, 'checks.jsonl'), JSON.stringify({ task, at: new Date().toISOString(), ok: r.status === 0, out: ((r.stdout ?? '') + (r.stderr ?? '')).slice(0, 4000) }) + '\n')
process.exit(r.status ?? 1)
