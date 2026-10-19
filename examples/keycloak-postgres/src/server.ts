import { serve } from 'pangol/node'
import { app } from './app.js'
import { pool } from './db.js'

const port = Number(process.env.PORT ?? 3000)
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT')
try {
  await pool.query('SELECT id FROM app_users LIMIT 0') // fail before listening if migration/DB is missing
} catch {
  await pool.end()
  throw new Error('Database is unavailable or migrations are missing')
}
const server = serve(app, { hostname: '127.0.0.1', port })
server.on('listening', () => console.log(`API: http://127.0.0.1:${port}`))
server.on('error', async () => { await pool.end(); process.exitCode = 1 })
let stopping = false
function shutdown() {
  if (stopping) return
  stopping = true
  const timer = setTimeout(() => { server.closeAllConnections(); process.exit(1) }, 25_000)
  timer.unref()
  server.close(async () => {
    try { await pool.end() } finally { clearTimeout(timer) }
  })
  server.closeIdleConnections()
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
