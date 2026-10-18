// node tools-make-run.mjs <name>  -> runs/<name>/task05..09 (brief spec, owner API docs)
import fs from 'node:fs'; import path from 'node:path'
const name = process.argv[2], root = '.', runDir = path.join(root, 'runs', name)
fs.rmSync(runDir, { recursive: true, force: true })
const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s) }
const brief = fs.readFileSync(path.join(root, 'kit/TASKS-brief.md'), 'utf8').split('\n').filter((l) => !/\*\*task0[1-4]\*\*|\*\*task10\*\*/.test(l)).join('\n')
w(path.join(runDir, 'TASKS.md'), brief)
w(path.join(runDir, 'HYPERFLAT.md'), fs.readFileSync(path.join(root, 'kit/HYPERFLAT.md'), 'utf8'))
for (const t of ['05', '06', '07', '08', '09']) {
  const d = path.join(runDir, 'task' + t)
  w(path.join(d, 'src/db.js'), fs.readFileSync(path.join(root, 'kit/db.js'), 'utf8'))
  w(path.join(d, 'src/auth.js'), "import { defineAuth } from 'hyperflat'\nimport { db } from './db.js'\n\nexport default defineAuth({\n  resolve: (token) => db.sessions.userForToken(token),\n})\n")
  w(path.join(d, 'package.json'), JSON.stringify({ name: 'task' + t, private: true, type: 'module', scripts: { check: 'hyperflat check' } }, null, 2) + '\n')
  fs.mkdirSync(path.join(d, 'src/routes'), { recursive: true })
}
console.log('created', runDir)
