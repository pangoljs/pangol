// SPEC section 14: wrk -t1 -c64, server and wrk pinned to different physical cores, servers alternated
// over ROUNDS rounds (the order rotates each round to cancel drift), median per server. Every server
// passes conform.mjs first. Writes results.json.
// usage: WRK=/path/to/wrk node bench.mjs [scenario ...]
// env: SERVER_CPU (default 2), WRK_CPU (default 4), ROUNDS (5), DURATION (8s), WARMUP (3s)
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { conform } from './conform.mjs'
import { start, stop } from './servers.mjs'

const WRK = process.env.WRK ?? 'wrk'
const SERVER_CPU = Number(process.env.SERVER_CPU ?? 2), WRK_CPU = Number(process.env.WRK_CPU ?? 4)
const ROUNDS = Number(process.env.ROUNDS ?? 5), DURATION = process.env.DURATION ?? '8s', WARMUP = process.env.WARMUP ?? '3s'
const PORT = 3200

writeFileSync(new URL('./post.lua', import.meta.url), `wrk.method = "POST"
wrk.body = '{"name":"Ann","email":"ann@example.com","age":30}'
wrk.headers["Content-Type"] = "application/json"
wrk.headers["Authorization"] = "Bearer t-admin"
`)
const SCENARIOS = {
  // /health: framework overhead against the bare server
  health: { path: '/health', args: [], servers: ['raw-bun', 'pangol-bun', 'elysia-bun', 'hono-bun', 'raw-node', 'pangol-node', 'hono-node'], status: 200 },
  // auth + permission + param validation + load + owner + response filtering (no passwordHash)
  get_user: { path: '/users/42', args: ['-H', 'Authorization: Bearer t-read'], servers: ['pangol-bun', 'elysia-bun', 'hono-bun', 'pangol-node', 'hono-node'], status: 200 },
  // auth + permission + content-type + JSON parse + body validation + filtering
  post_user: { path: '/users', args: ['-s', 'post.lua'], servers: ['pangol-bun', 'elysia-bun', 'hono-bun', 'pangol-node', 'hono-node'], status: 201 },
}

const ms = (text) => { const m = /([\d.]+)(us|ms|s)/.exec(text); return m ? Number(m[1]) * (m[2] === 'us' ? 0.001 : m[2] === 's' ? 1000 : 1) : NaN }
function wrk(scenario, duration) {
  const out = execFileSync('taskset', ['-c', String(WRK_CPU), WRK, '-t1', '-c64', `-d${duration}`, '--latency', ...scenario.args, `http://127.0.0.1:${PORT}${scenario.path}`],
    { cwd: import.meta.dirname, encoding: 'utf8' })
  const bad = Number(/Non-2xx or 3xx responses: (\d+)/.exec(out)?.[1] ?? 0) + Number(/Socket errors:.*timeout (\d+)/.exec(out)?.[1] ?? 0)
  // anchored: "99.26%" in the Thread Stats table must not be read as the 99th percentile
  return { rps: Number(/Requests\/sec:\s+([\d.]+)/.exec(out)[1]), p50: ms(/^\s+50%\s+(\S+)/m.exec(out)[1]), p99: ms(/^\s+99%\s+(\S+)/m.exec(out)[1]), bad }
}
const rss = (pid) => Math.round(Number(execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], { encoding: 'utf8' }).trim()) / 1024)
const median = (xs) => [...xs].sort((a, b) => a - b)[xs.length >> 1]

// conformance first: a server that answers differently is not doing the same work
for (const name of new Set(Object.values(SCENARIOS).flatMap((s) => s.servers).filter((n) => !n.startsWith('raw-')))) {
  const p = await start(name, PORT)
  try {
    const bad = (await conform(PORT)).filter((r) => !r.ok)
    if (bad.length > 0) throw new Error(`${name} failed conformance: ${bad.map((r) => r.label).join(', ')}`)
  } finally { await stop(p) }
}

const chosen = process.argv.length > 2 ? process.argv.slice(2) : Object.keys(SCENARIOS)
const results = { config: { wrk: '-t1 -c64', duration: DURATION, warmup: WARMUP, rounds: ROUNDS, serverCpu: SERVER_CPU, wrkCpu: WRK_CPU }, scenarios: {} }
for (const key of chosen) {
  const scenario = SCENARIOS[key]
  const runs = Object.fromEntries(scenario.servers.map((n) => [n, []]))
  for (let round = 0; round < ROUNDS; round++) {
    const order = scenario.servers.map((_, i) => scenario.servers[(i + round) % scenario.servers.length])
    for (const name of order) {
      const p = await start(name, PORT, SERVER_CPU)
      try {
        wrk(scenario, WARMUP) // JIT warm-up
        const r = wrk(scenario, DURATION)
        if (r.bad > 0) throw new Error(`${name} ${key}: ${r.bad} bad responses`)
        runs[name].push({ ...r, rss: rss(p.pid) })
        console.log(`${key.padEnd(9)} round ${round + 1} ${name.padEnd(12)} ${Math.round(r.rps)} req/s  p99 ${r.p99} ms`)
      } finally { await stop(p) }
    }
  }
  results.scenarios[key] = Object.fromEntries(Object.entries(runs).map(([name, rs]) => [name, {
    rps: Math.round(median(rs.map((r) => r.rps))), p50_ms: median(rs.map((r) => r.p50)), p99_ms: median(rs.map((r) => r.p99)),
    rss_mb: median(rs.map((r) => r.rss)), runs: rs.map((r) => Math.round(r.rps)),
  }]))
}
writeFileSync(new URL('./results.json', import.meta.url), JSON.stringify(results, null, 2) + '\n')
console.log(JSON.stringify(results.scenarios, null, 2))
