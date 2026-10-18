// Full sweep. usage: node bench.mjs 10 50 200   (resources; routes = x10)
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'

const RUNS = 3
const median = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)]
const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26, timeout: 900_000, ...opts })

function tsc(dir, which) {
  const runs = []
  for (let i = 0; i < RUNS; i++) {
    let out
    try { out = sh('node', ['--max-old-space-size=6144', 'node_modules/typescript/bin/tsc', '-p', `${dir}/tsconfig.${which}.json`, '--extendedDiagnostics']) }
    catch (e) { out = e.stdout ?? ''; if (!/Check time/.test(out)) return { error: (e.stderr || e.message).slice(0, 300) } }
    const g = (re) => Number(out.match(re)?.[1])
    runs.push({ errors: (out.match(/error TS/g) ?? []).length, inst: g(/Instantiations:\s+(\d+)/), check: g(/Check time:\s+([\d.]+)s/), total: g(/Total time:\s+([\d.]+)s/), memMB: Math.round(g(/Memory used:\s+(\d+)K/) / 1024) })
  }
  return { errors: runs[0].errors, inst: runs[0].inst, check: median(runs.map((r) => r.check)), total: median(runs.map((r) => r.total)), memMB: median(runs.map((r) => r.memMB)) }
}
function ide(dir, v, R) {
  const runs = []
  for (let i = 0; i < RUNS; i++) runs.push(JSON.parse(sh('node', ['--max-old-space-size=6144', 'bench-ls.mjs', dir, v, String(Math.floor(R / 2)), String(R)]).trim()))
  const m = {}
  for (const k of ['cold_route', 'warm_route', 'resp_fields', 'diag_edit']) m[k] = median(runs.map((r) => r[k]))
  m.ok = runs.every((r) => r.resp_has_name && r.cold_route_entries > 0)
  return m
}

const results = []
for (const R of process.argv.slice(2).map(Number)) {
  const N = R * 10
  sh('node', ['gen.mjs', String(R)])
  const cg = []
  for (let i = 0; i < RUNS; i++) cg.push(Number(sh('npx', ['tsx', 'lib/build.ts', `out/${N}/ours`]).match(/in (\d+) ms/)[1]))
  const row = { routes: N, codegen_ms: median(cg) }
  for (const v of ['hono', 'ours']) {
    row[v] = { server: tsc(`out/${N}/${v}`, 'server'), client: tsc(`out/${N}/${v}`, 'client'), ide: ide(`out/${N}/${v}`, v, R) }
    console.error(N, v, JSON.stringify(row[v]))
  }
  results.push(row)
  fs.writeFileSync('results.json', JSON.stringify(results, null, 2))
}
console.log(JSON.stringify(results, null, 2))
