// Throughput/latency with wrk. Server pinned to CPU 0, wrk pinned to CPU 1 (per-core comparison).
// usage: node bench.mjs [server ...]   -> appends to results.json
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { start, conform, SERVERS } from './conform.mjs'

const PORT = 3200, RUNS = 3, DUR = '10s', CONN = 64
fs.writeFileSync('post.lua', `wrk.method = "POST"
wrk.body = '{"name":"Ann","email":"ann@example.com","age":30}'
wrk.headers["Content-Type"] = "application/json"
wrk.headers["Authorization"] = "Bearer t-admin"
`)
const SCEN = {
  health: ['/health'],
  get_user: ['/users/42', '-H', 'Authorization: Bearer t-admin'],
  post_user: ['/users', '-s', 'post.lua'],
}
function wrk(args, dur) {
  const [p, ...rest] = args
  const out = execFileSync('taskset', ['-c', '1', 'wrk', '-t1', `-c${CONN}`, `-d${dur}`, '--latency', ...rest, `http://127.0.0.1:${PORT}${p}`], { encoding: 'utf8' })
  const ms = (s) => { const m = s.match(/([\d.]+)(us|ms|s)/); return m ? Number(m[1]) * (m[2] === 'us' ? 0.001 : m[2] === 's' ? 1000 : 1) : NaN }
  return {
    rps: Number(out.match(/Requests\/sec:\s+([\d.]+)/)[1]),
    p50: ms(out.match(/50%\s+(\S+)/)[1]),
    p99: ms(out.match(/99%\s+(\S+)/)[1]),
    bad: Number(out.match(/Non-2xx or 3xx responses: (\d+)/)?.[1] ?? 0) + Number(out.match(/Socket errors:.*timeout (\d+)/)?.[1] ?? 0),
  }
}
const median = (a, k) => [...a].sort((x, y) => x[k] - y[k])[Math.floor(a.length / 2)]

const names = process.argv.slice(2).length ? process.argv.slice(2) : ['raw-bun', 'raw-node', ...Object.keys(SERVERS)]
const results = fs.existsSync('results.json') ? JSON.parse(fs.readFileSync('results.json', 'utf8')) : {}
for (const name of names) {
  const proc = await start(name, PORT, 0)
  try {
    const scen = name.startsWith('raw-') ? ['health'] : Object.keys(SCEN)
    if (!name.startsWith('raw-')) {
      const bad = (await conform(name, PORT)).filter((r) => !r.ok)
      if (bad.length) throw new Error(name + ' failed conformance')
    }
    for (const s of scen) wrk(SCEN[s], '4s') // JIT warm-up
    results[name] = {}
    for (const s of scen) {
      const runs = Array.from({ length: RUNS }, () => wrk(SCEN[s], DUR))
      const m = median(runs, 'rps')
      results[name][s] = { rps: Math.round(m.rps), p50_ms: m.p50, p99_ms: m.p99, non2xx: runs.reduce((a, r) => a + r.bad, 0), runs: runs.map((r) => Math.round(r.rps)) }
      console.log(name.padEnd(11), s.padEnd(10), JSON.stringify(results[name][s]))
    }
    const rss = Number(execFileSync('ps', ['-o', 'rss=', '-p', String(proc.pid)], { encoding: 'utf8' }).trim())
    results[name].rss_mb = Math.round(rss / 1024)
  } finally {
    proc.kill()
    await new Promise((r) => setTimeout(r, 500))
  }
  fs.writeFileSync('results.json', JSON.stringify(results, null, 2))
}
