#!/usr/bin/env node
// hyperflat check [--manifest out.json]   build checks (+ write the security manifest)
// hyperflat serve [port]                  check, then start the server
// hyperflat diff before.json after.json   compare two manifests
// hyperflat diff main..HEAD | diff main   compare git refs (or a ref vs the working tree)
//   diff options: --fail-on high|check    exit 1 when findings of that level exist
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { loadProject } from './project.mjs'
import { createServer } from './server.mjs'
import { buildManifest, diffManifests, renderDiff } from './manifest.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0] ?? 'check'
const opt = (name) => { const i = argv.indexOf(name); return i === -1 ? undefined : argv[i + 1] }
const positional = argv.slice(1).filter((x, i, all) => !x.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')))
const dir = path.resolve(process.env.HYPERFLAT_DIR ?? '.')

async function manifestFor(projectDir) {
  const project = await loadProject(projectDir)
  if (project.problems.length) return { problems: project.problems }
  return { manifest: buildManifest(projectDir, project.routes), project }
}

// export a git ref of this project into a temp folder inside the project (so node_modules resolve)
function checkoutRef(ref) {
  const top = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
  const prefix = path.relative(top, dir)
  const sha = execFileSync('git', ['-C', dir, 'rev-parse', '--short', ref], { encoding: 'utf8' }).trim()
  const target = path.join(dir, '.hyper', 'refs', sha)
  fs.rmSync(target, { recursive: true, force: true })
  fs.mkdirSync(target, { recursive: true })
  const tar = execFileSync('git', ['-C', top, 'archive', '--format=tar', sha, prefix || '.'], { maxBuffer: 1 << 28 })
  execFileSync('tar', ['-x', '-C', target], { input: tar })
  return { path: path.join(target, prefix), label: `${ref} (${sha})` }
}

if (cmd === 'diff') {
  let a, b, title
  const fail = (msg) => { console.error(msg); process.exit(2) }
  if (positional.length === 2 && positional.every((p) => p.endsWith('.json'))) {
    ;[a, b] = positional.map((p) => JSON.parse(fs.readFileSync(p, 'utf8')))
    title = `${positional[0]} → ${positional[1]}`
  } else if (positional.length === 1) {
    const [from, to] = positional[0].includes('..') ? positional[0].split('..') : [positional[0], null]
    const side = async (ref) => {
      const src = ref ? checkoutRef(ref) : { path: dir, label: 'working tree' }
      const r = await manifestFor(src.path)
      if (r.problems) fail(`✖ ${src.label} does not pass \`hyperflat check\`:\n\n${r.problems.join('\n\n')}`)
      return [r.manifest, src.label]
    }
    const [ma, la] = await side(from)
    const [mb, lb] = await side(to || null)
    a = ma; b = mb; title = `${la} → ${lb}`
  } else fail('usage: hyperflat diff before.json after.json | hyperflat diff <ref>..<ref> | hyperflat diff <ref>')
  const d = diffManifests(a, b)
  const md = renderDiff(d, title)
  console.log(md)
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(d, null, 2))
  const failOn = opt('--fail-on')
  if ((failOn === 'high' && d.high.length) || (failOn === 'check' && (d.high.length || d.check.length))) process.exit(1)
  process.exit(0)
}

const project = await loadProject(dir)
if (project.problems.length) {
  console.error(project.problems.join('\n\n'))
  console.error(`\n${project.problems.length} problem(s). Nothing was started.`)
  process.exit(1)
}
if (cmd === 'check') {
  console.log(`✔ ${project.routes.length} routes OK`)
  for (const r of project.routes) {
    const auth = typeof r.def.auth === 'object' ? 'permission ' + r.def.auth.permission : r.def.auth
    const owner = typeof r.def.owner === 'function' ? 'rule' : r.def.owner
    console.log(`  ${r.method.padEnd(6)} ${r.path}  [auth: ${auth}${owner ? `, owner: ${owner}` : ''}]`)
  }
  const out = opt('--manifest')
  if (out) { fs.writeFileSync(out, JSON.stringify(buildManifest(dir, project.routes), null, 2) + '\n'); console.log(`manifest written to ${out}`) }
} else if (cmd === 'serve') {
  const port = Number(positional[0] ?? process.env.PORT ?? 3000)
  createServer(project).listen(port, () => console.log(`listening on :${port}`))
} else {
  console.error('usage: hyperflat check [--manifest out.json] | serve [port] | diff ...')
  process.exit(2)
}
