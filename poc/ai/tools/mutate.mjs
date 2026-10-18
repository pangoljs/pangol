// Mutation test for the build check: take every route the agents wrote, remove one security
// declaration at a time, and confirm `check` rejects the result.
// usage: node tools/mutate.mjs runs/hyper-haiku runs/hyper-sonnet ...
import path from 'node:path'
import { loadProject, checkRoute } from '../hyperflat/project.mjs'

const MUTATIONS = {
  'remove auth': (d) => { delete d.auth },
  'remove response schema': (d) => { delete d.response },
  'remove params schema': (d, r) => (r.segs.some((s) => s.startsWith(':')) ? (delete d.params, true) : false),
  'remove body schema': (d) => (d.body ? (delete d.body, true) : false),
  'remove query schema': (d) => (d.query ? (delete d.query, true) : false),
  'typo: auht instead of auth': (d) => { d.auht = d.auth; delete d.auth },
  'typo: respons instead of response': (d) => { d.respons = d.response; delete d.response },
  "downgrade to auth 'public' while reading c.user": (d) => (/\b(user)\b/.test(d.handler.toString()) && d.auth !== 'public' ? (d.auth = 'public', true) : false),
}

const tally = {}
let originals = 0, originalFail = 0
const misses = []
for (const runDir of process.argv.slice(2)) {
  for (let i = 1; i <= 10; i++) {
    const dir = path.resolve(runDir, `task${String(i).padStart(2, '0')}`)
    const { routes, problems } = await loadProject(dir)
    if (problems.length) { originalFail++; continue }
    for (const r of routes) {
      originals++
      const names = r.segs.filter((s) => s.startsWith(':')).map((s) => s.slice(1))
      for (const [name, mutate] of Object.entries(MUTATIONS)) {
        const def = { ...r.def }
        if (mutate(def, r) === false) continue
        const errs = checkRoute(def, r.method, r.path, names)
        const t = (tally[name] ??= { applied: 0, caught: 0 })
        t.applied++
        if (errs.length) t.caught++
        else misses.push(`${path.basename(runDir)}/${r.file}: ${name}`)
      }
    }
  }
}
console.log(`routes: ${originals} (projects failing check before mutation: ${originalFail})`)
let A = 0, C = 0
for (const [name, t] of Object.entries(tally)) { console.log(`${name.padEnd(52)} caught ${t.caught}/${t.applied}`); A += t.applied; C += t.caught }
console.log(`${'TOTAL'.padEnd(52)} caught ${C}/${A} (${((C / A) * 100).toFixed(1)}%)`)
if (misses.length) console.log('missed:\n  ' + misses.join('\n  '))
