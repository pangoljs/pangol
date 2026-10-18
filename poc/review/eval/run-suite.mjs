// Applies each simulated PR to a copy of ../app, then:
//  1. runs `hyperflat check --manifest` (blocked at build = caught),
//  2. diffs the manifest against the base app's manifest,
//  3. for vulnerable PRs, runs hidden tests to prove the vulnerability is real.
// usage: node eval/run-suite.mjs [variantId ...]
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { VARIANTS } from './variants.mjs'
import { diffManifests, renderDiff } from '../hyperflat/manifest.mjs'

const root = path.resolve(new URL('..', import.meta.url).pathname)
const app = path.join(root, 'app')
const work = path.join(root, 'eval/work')
const cli = path.join(root, 'hyperflat/cli.mjs')
const only = process.argv.slice(2)
fs.mkdirSync(work, { recursive: true })

const manifestOf = (dir) => {
  const out = path.join(dir, '.manifest.json')
  const r = spawnSync('node', [cli, 'check', '--manifest', out], { cwd: dir, encoding: 'utf8' })
  return r.status === 0 ? { manifest: JSON.parse(fs.readFileSync(out, 'utf8')) } : { blocked: (r.stderr || r.stdout).trim() }
}
const base = manifestOf(app)
if (!base.manifest) throw new Error('base app fails check:\n' + base.blocked)

function apply(dir, edits) {
  for (const e of edits) {
    const f = path.join(dir, e.file)
    if (e.create !== undefined) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, e.create); continue }
    const src = fs.readFileSync(f, 'utf8')
    if (!src.includes(e.from)) throw new Error(`edit not applicable in ${e.file}: ${e.from.slice(0, 60)}`)
    fs.writeFileSync(f, src.replace(e.from, e.to))
  }
}

function confirmVuln(dir, spec) {
  const [round, task, prefix] = spec.split(':')
  const runs = path.join(work, '_runs', path.basename(dir))
  fs.mkdirSync(runs, { recursive: true })
  fs.rmSync(path.join(runs, task), { force: true })
  fs.symlinkSync(dir, path.join(runs, task))
  const out = execFileSync('node', [path.join(root, 'score.mjs'), runs, 'hyper', task], { cwd: root, encoding: 'utf8', env: { ...process.env, TESTS: round === '2' ? './tests2.mjs' : './tests.mjs' }, maxBuffer: 1 << 24 })
  const t = JSON.parse(out).results[task].find((x) => x.name.startsWith(prefix))
  if (!t) throw new Error(`no hidden test ${spec}`)
  return !t.pass // vulnerability confirmed when the test fails
}

const results = []
for (const v of VARIANTS) {
  if (only.length && !only.includes(v.id)) continue
  const dir = path.join(work, v.id)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.cpSync(app, dir, { recursive: true, filter: (s) => !s.includes('.manifest.json') })
  apply(dir, v.edits)
  const m = manifestOf(dir)
  let outcome, d = null
  if (m.blocked) outcome = 'blocked'
  else {
    d = diffManifests(base.manifest, m.manifest)
    outcome = d.high.length ? 'high' : d.check.length ? 'check' : d.info.length || d.ok.length ? 'info-only' : 'silent'
  }
  const confirmed = v.kind === 'vuln' && !m.blocked && v.confirm.length ? v.confirm.every((c) => confirmVuln(dir, c)) : null
  fs.writeFileSync(path.join(work, `${v.id}.md`), m.blocked ? `## ${v.id} blocked by check\n\n\`\`\`\n${m.blocked}\n\`\`\`\n` : renderDiff(d, `${v.id}: ${v.what}`))
  results.push({ id: v.id, kind: v.kind, cls: v.cls ?? '', what: v.what, outcome, confirmed, findings: d ?? { blocked: m.blocked } })
  console.log(`${v.id} ${v.kind.padEnd(6)} ${outcome.padEnd(9)} ${confirmed === null ? '' : confirmed ? '(vuln confirmed)' : '(NOT confirmed!)'}  ${v.what}`)
}
fs.writeFileSync(path.join(root, 'eval/suite-results.json'), JSON.stringify(results, null, 2))

const vul = results.filter((r) => r.kind === 'vuln'), ben = results.filter((r) => r.kind === 'benign')
const cnt = (list, o) => list.filter((r) => o.includes(r.outcome)).length
console.log(`\nvulnerable PRs: ${vul.length} | blocked ${cnt(vul, ['blocked'])} | 🔴 ${cnt(vul, ['high'])} | 🟡 ${cnt(vul, ['check'])} | missed ${cnt(vul, ['info-only', 'silent'])}`)
console.log(`benign PRs:     ${ben.length} | 🔴 false alarm ${cnt(ben, ['high'])} | 🟡 ${cnt(ben, ['check'])} | quiet ${cnt(ben, ['info-only', 'silent'])} | blocked ${cnt(ben, ['blocked'])}`)
