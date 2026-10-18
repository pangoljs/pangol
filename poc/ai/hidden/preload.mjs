// Loaded with `node --import` into the server under test. Imports the SAME src/db.js module the
// app uses (same URL -> same instance) and exposes its state on DEBUG_PORT, so tests can verify
// what was actually stored, not just what the API answered.
import http from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const { db } = await import(pathToFileURL(path.join(process.cwd(), 'src/db.js')).href)
const orders = () => { const out = []; for (let i = 1; i <= 50; i++) { const o = db.orders.get(String(i)); if (o) out.push(o) } return out }
http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'application/json' })
  res.end(JSON.stringify({ users: db.users.all(), posts: db.posts.all(), products: [db.products.get('1'), db.products.get('2')], orders: orders() }))
}).listen(Number(process.env.DEBUG_PORT), '127.0.0.1').unref()
