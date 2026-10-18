// A/B on one scenario with alternating runs to cancel drift. usage: node bench-ab.mjs <scenario> <serverA> <serverB> [rounds]
import { execFileSync } from 'node:child_process'
import { start } from './conform.mjs'
const [scen, A, B, rounds = 5] = process.argv.slice(2)
const ARGS = { health: ['/health'], get_user: ['/users/42', '-H', 'Authorization: Bearer t-admin'], post_user: ['/users', '-s', 'post.lua'] }[scen]
const run = async (name, dur) => {
  const p = await start(name, 3400, 0)
  try {
    execFileSync('taskset', ['-c', '1', 'wrk', '-t1', '-c64', '-d3s', ...ARGS.slice(1), 'http://127.0.0.1:3400' + ARGS[0]])
    const out = execFileSync('taskset', ['-c', '1', 'wrk', '-t1', '-c64', `-d${dur}`, ...ARGS.slice(1), 'http://127.0.0.1:3400' + ARGS[0]], { encoding: 'utf8' })
    return Number(out.match(/Requests\/sec:\s+([\d.]+)/)[1])
  } finally { p.kill(); await new Promise((r) => setTimeout(r, 400)) }
}
const res = { [A]: [], [B]: [] }
for (let i = 0; i < rounds; i++) for (const n of i % 2 ? [B, A] : [A, B]) res[n].push(Math.round(await run(n, '8s')))
const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1]
console.log(scen, A, med(res[A]), res[A].join(','), '|', B, med(res[B]), res[B].join(','), '| diff', ((med(res[B]) / med(res[A]) - 1) * 100).toFixed(1) + '%')
