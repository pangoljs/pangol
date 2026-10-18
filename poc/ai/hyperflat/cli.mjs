#!/usr/bin/env node
// hyperflat check            -> run build checks (exit 1 on problems)
// hyperflat serve [port]     -> check, then start the server
import path from 'node:path'
import { loadProject } from './project.mjs'
import { createServer } from './server.mjs'

const [cmd = 'check', arg] = process.argv.slice(2)
const dir = path.resolve(process.env.HYPERFLAT_DIR ?? '.')
const project = await loadProject(dir)
if (project.problems.length) {
  console.error(project.problems.join('\n\n'))
  console.error(`\n${project.problems.length} problem(s). Nothing was started.`)
  process.exit(1)
}
if (cmd === 'check') {
  console.log(`✔ ${project.routes.length} routes OK`)
  for (const r of project.routes) console.log(`  ${r.method.padEnd(6)} ${r.path}  [auth: ${typeof r.def.auth === 'object' ? 'permission ' + r.def.auth.permission : r.def.auth}]`)
} else if (cmd === 'serve') {
  const port = Number(arg ?? process.env.PORT ?? 3000)
  createServer(project).listen(port, () => console.log(`listening on :${port}`))
} else {
  console.error('usage: hyperflat check | hyperflat serve [port]')
  process.exit(2)
}
