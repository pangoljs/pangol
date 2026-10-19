// A loopback OAuth client for trying the API before building a frontend.
import { createServer } from 'node:http'
import { randomBytes, createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'

const issuer = process.env.KEYCLOAK_ISSUER ?? 'http://127.0.0.1:8080/realms/pangol-demo'
const target = new URL(issuer)
if (target.protocol !== 'https:' && !(target.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(target.hostname))) throw new Error('Use HTTPS for a remote Keycloak')
if (target.username || target.password || target.search || target.hash) throw new Error('Invalid issuer')
const redirect = 'http://127.0.0.1:8787/callback'
const clientId = process.env.KEYCLOAK_CLIENT_ID ?? 'pangol-cli'
const verifier = randomBytes(32).toString('base64url')
const state = randomBytes(32).toString('base64url')
const authorization = new URL(`${issuer}/protocol/openid-connect/auth`)
for (const [key, value] of Object.entries({ client_id: clientId, redirect_uri: redirect, response_type: 'code', scope: 'openid', state,
  code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', prompt: 'login' })) authorization.searchParams.set(key, value)
let completed = false
const server = createServer(async (req, res) => {
  const url = new URL(req.url, redirect)
  res.setHeader('content-type', 'text/plain; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('referrer-policy', 'no-referrer')
  res.setHeader('x-content-type-options', 'nosniff')
  if (req.method !== 'GET' || url.pathname !== '/callback' || url.searchParams.get('state') !== state || completed) {
    res.writeHead(400); res.end('Invalid callback'); return
  }
  completed = true
  try {
    const code = url.searchParams.get('code')
    if (!code || url.searchParams.has('error')) throw new Error('Login was not completed')
    const response = await fetch(`${issuer}/protocol/openid-connect/token`, { method: 'POST', signal: AbortSignal.timeout(5000),
      body: new URLSearchParams({ grant_type: 'authorization_code', client_id: clientId, redirect_uri: redirect, code_verifier: verifier, code }) })
    if (!response.ok) throw new Error('Token exchange failed')
    const token = await response.json()
    if (typeof token.access_token !== 'string' || typeof token.expires_in !== 'number') throw new Error('Invalid token response')
    await mkdir(new URL('../.local/', import.meta.url), { recursive: true, mode: 0o700 })
    await writeFile(new URL('../.local/token.json', import.meta.url), JSON.stringify({ accessToken: token.access_token, expiresAt: Date.now() + token.expires_in * 1000 }), { mode: 0o600 })
    res.end('Login complete. Return to the terminal. You can close this window.')
    console.log('Saved short-lived access token to .local/token.json. Run: node scripts/api.mjs GET /me')
  } catch {
    res.writeHead(400); res.end('Login failed. Run the login command again.')
    process.exitCode = 1
  } finally { clearTimeout(timer); server.close() }
})
const timer = setTimeout(() => { console.error('Login timed out'); server.close(); process.exitCode = 1 }, 180_000)
server.on('error', () => { clearTimeout(timer); console.error('Cannot listen on 127.0.0.1:8787'); process.exitCode = 1 })
server.listen(8787, '127.0.0.1', () => console.log(`Open this URL in your browser:\n${authorization}`))
