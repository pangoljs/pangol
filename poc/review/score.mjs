// Runs the hidden tests against one workspace. Fresh server per test case.
// usage: node score.mjs <run dir> <hyper|hono> [taskNN ...]  -> prints JSON summary
import { spawn } from 'node:child_process'
import net from 'node:net'
import path from 'node:path'
import fs from 'node:fs'
const { TESTS } = await import(process.env.TESTS ?? './tests.mjs')

const [runDir, kind, ...only] = process.argv.slice(2)
let port = 4100 + Math.floor(Math.random() * 20000)

const waitPort = (p, ms) => new Promise((resolve) => {
  const end = Date.now() + ms
  const tryOnce = () => {
    const s = net.connect(p, '127.0.0.1')
    s.on('connect', () => { s.destroy(); resolve(true) })
    s.on('error', () => { s.destroy(); if (Date.now() > end) resolve(false); else setTimeout(tryOnce, 50) })
  }
  tryOnce()
})

const portFree = (p) => new Promise((resolve) => {
  const srv = net.createServer()
  srv.once('error', () => resolve(false))
  srv.listen(p, '127.0.0.1', () => srv.close(() => resolve(true)))
})

async function startServer(taskDir) {
  let p = ++port
  while (!(await portFree(p))) p = ++port
  let dp = ++port
  while (!(await portFree(dp))) dp = ++port
  const pre = ['--import', new URL('./preload.mjs', import.meta.url).href]
  const [cmd, args] = kind === 'hyper' ? ['node', [...pre, './hyperflat/cli.mjs', 'serve', String(p)]] : ['node', [...pre, 'src/server.js']]
  const proc = spawn(cmd, args, { cwd: taskDir, env: { ...process.env, PORT: String(p), DEBUG_PORT: String(dp), NODE_ENV: 'production' }, stdio: ['ignore', 'ignore', 'pipe'] })
  let err = ''
  proc.stderr.on('data', (d) => { if (err.length < 4000) err += d })
  let exited = false
  proc.on('exit', () => { exited = true })
  const ok = await waitPort(p, 6000)
  await new Promise((r) => setTimeout(r, 60)) // a server that lost the port race exits right away
  if (!ok || exited) { proc.kill('SIGKILL'); return { error: err.trim().split('\n').slice(0, 6).join('\n') || 'server did not start' } }
  return { proc, port: p, debugPort: dp, stderr: () => err }
}

function client(p) {
  return async (method, urlPath, o = {}) => {
    const headers = { ...(o.headers ?? {}) }
    if (o.token) headers.authorization = `Bearer ${o.token}`
    let body
    if (o.raw !== undefined) { body = o.raw; if (o.ct) headers['content-type'] = o.ct }
    else if (o.body !== undefined) { body = JSON.stringify(o.body); headers['content-type'] = 'application/json' }
    try {
      const res = await fetch(`http://127.0.0.1:${p}${urlPath}`, { method, headers, body, signal: AbortSignal.timeout(4000) })
      const text = await res.text()
      let json
      try { json = JSON.parse(text) } catch {}
      return { status: res.status, text, json }
    } catch (e) { return { status: 0, text: String(e), json: undefined } }
  }
}

const results = {}
for (const task of Object.keys(TESTS)) {
  if (only.length && !only.includes(task)) continue
  const taskDir = path.join(runDir, task)
  results[task] = []
  for (const [kindOf, name, fn] of TESTS[task]) {
    const s = await startServer(taskDir)
    if (s.error) { results[task].push({ kind: kindOf, name, pass: false, note: 'server failed: ' + s.error.slice(0, 300) }); continue }
    let pass = false, note
    const st = async () => (await fetch(`http://127.0.0.1:${s.debugPort}/`)).json()
    try { pass = !!(await fn(client(s.port), st)) } catch (e) { note = String(e).slice(0, 200) }
    s.proc.kill('SIGKILL')
    results[task].push({ kind: kindOf, name, pass, ...(note ? { note } : {}) })
  }
}
const sum = (f) => Object.values(results).flat().filter(f).length
const out = {
  run: path.basename(runDir), kind,
  func: { pass: sum((r) => r.kind === 'func' && r.pass), total: sum((r) => r.kind === 'func') },
  sec: { pass: sum((r) => r.kind === 'sec' && r.pass), total: sum((r) => r.kind === 'sec') },
  tasksFullyCorrect: Object.values(results).filter((rs) => rs.every((r) => r.pass)).length,
  results,
}
console.log(JSON.stringify(out, null, 2))
