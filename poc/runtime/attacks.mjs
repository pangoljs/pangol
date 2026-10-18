// Same attack requests against every server, sent over raw TCP so paths arrive byte-for-byte.
// Prints what each server did. usage: node attacks.mjs [server ...]
import net from 'node:net'
import { start } from './conform.mjs'

const AUTH = 'Authorization: Bearer t-admin\r\n'
const post = (body) => `POST /users HTTP/1.1\r\nHost: x\r\n${AUTH}Content-Type: application/json\r\nContent-Length: ${Buffer.byteLength(body)}\r\nConnection: close\r\n\r\n${body}`
const get = (p) => `GET ${p} HTTP/1.1\r\nHost: x\r\n${AUTH}Connection: close\r\n\r\n`
const ok = '"name":"Ann","email":"ann@example.com"'
export const ATTACKS = [
  ['encoded slash in param', get('/users/4%2F2')],
  ['encoded dot-dot param', get('/users/%2e%2e')],
  ['raw dot-dot', get('/users/..')],
  ['encoded digits (%34%32 = 42)', get('/users/%34%32')],
  ['NUL byte in param', get('/users/42%00')],
  ['duplicate key, last wins', post(`{${ok},"age":"x","age":30}`)],
  ['deep nesting in unknown field', post(`{${ok},"age":30,"x":${'['.repeat(5000)}${']'.repeat(5000)}}`)],
  ['__proto__ in body', post(`{${ok},"age":30,"__proto__":{"admin":true}}`)],
]

function send(port, raw) {
  return new Promise((resolve) => {
    let buf = ''
    const s = net.connect(port, '127.0.0.1', () => s.write(raw))
    s.on('data', (d) => (buf += d))
    s.on('end', () => resolve(buf))
    s.on('error', (e) => resolve('ERR ' + e.code))
    setTimeout(() => { s.destroy(); resolve(buf || 'TIMEOUT') }, 3000)
  })
}
const names = process.argv.slice(2).length ? process.argv.slice(2) : ['hyper-bun', 'hyper-bun-fullurl', 'hyper-node', 'hono-bun', 'hono-node', 'elysia-bun', 'go']
const table = {}
for (const name of names) {
  const p = await start(name, 3500)
  try {
    table[name] = []
    for (const [, raw] of ATTACKS) {
      const out = await send(3500, raw)
      const status = out.startsWith('HTTP/') ? out.split(' ')[1] : out
      const body = out.slice(out.indexOf('\r\n\r\n') + 4)
      const leak = status === '200' || status === '201' ? ' ok' : ''
      table[name].push(status + leak)
    }
  } finally { p.kill(); await new Promise((r) => setTimeout(r, 300)) }
}
console.log('attack'.padEnd(32) + names.map((n) => n.slice(0, 12).padEnd(13)).join(''))
ATTACKS.forEach(([label], i) => console.log(label.padEnd(32) + names.map((n) => table[n][i].padEnd(13)).join('')))
