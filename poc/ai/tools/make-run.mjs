// Creates a fresh workspace: runs/<name>/task01..task10 for one framework.
// usage: node tools/make-run.mjs <name> <hyper|hono>
import fs from 'node:fs'
import path from 'node:path'

const [name, kind] = process.argv.slice(2)
if (!name || !['hyper', 'hono'].includes(kind)) { console.error('usage: make-run.mjs <name> <hyper|hono>'); process.exit(2) }
const root = '..'
const runDir = path.join(root, 'runs', name)
fs.rmSync(runDir, { recursive: true, force: true })
fs.rmSync(path.join(root, 'logs', name), { recursive: true, force: true })
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s) }

w(path.join(runDir, 'TASKS.md'), fs.readFileSync(path.join(root, process.env.SPEC ?? 'kit/TASKS.md'), 'utf8'))
if (kind === 'hyper') w(path.join(runDir, 'HYPERFLAT.md'), fs.readFileSync(path.join(root, 'kit/HYPERFLAT.md'), 'utf8'))

for (let i = 1; i <= 10; i++) {
  const d = path.join(runDir, `task${String(i).padStart(2, '0')}`)
  w(path.join(d, 'src/db.js'), fs.readFileSync(path.join(root, 'kit/db.js'), 'utf8'))
  w(path.join(d, 'package.json'), JSON.stringify({ name: path.basename(d), private: true, type: 'module', scripts: { check: `node ${root}/tools/check.mjs ${kind}` } }, null, 2) + '\n')
  if (kind === 'hyper') {
    w(path.join(d, 'src/auth.js'), `import { defineAuth } from 'hyperflat'
import { db } from './db.js'

// Bearer token -> user (or undefined). The returned object becomes c.user.
export default defineAuth({
  resolve: (token) => db.sessions.userForToken(token),
})
`)
    fs.mkdirSync(path.join(d, 'src/routes'), { recursive: true })
  } else {
    w(path.join(d, 'src/server.js'), `import { serve } from '@hono/node-server'
import app from './app.js'

serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 3000) })
`)
    w(path.join(d, 'src/app.js'), `import { Hono } from 'hono'
import { db } from './db.js'

const app = new Hono()

// your routes here

export default app
`)
  }
}
console.log(`created ${runDir} (${kind})`)
