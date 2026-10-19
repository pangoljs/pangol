import { readFile } from 'node:fs/promises'
const [method = 'GET', path = '/me', json] = process.argv.slice(2)
const { accessToken, expiresAt } = JSON.parse(await readFile(new URL('../.local/token.json', import.meta.url), 'utf8'))
if (Date.now() >= expiresAt) throw new Error('Token expired: run npm run login again')
const base = new URL(process.env.API_URL ?? 'http://127.0.0.1:3000')
const url = new URL(path, base)
if (!path.startsWith('/') || url.origin !== base.origin) throw new Error('Use a path on this API')
if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(base.hostname))) throw new Error('Use HTTPS for a remote API')
const response = await fetch(url, { method, redirect: 'error', signal: AbortSignal.timeout(10000),
  headers: { authorization: `Bearer ${accessToken}`, ...(json && { 'content-type': 'application/json' }) },
  ...(json && { body: JSON.stringify(JSON.parse(json)) }),
})
console.log(response.status, await response.text())
if (!response.ok) process.exitCode = 1
