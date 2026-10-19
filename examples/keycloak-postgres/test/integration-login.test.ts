import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { cp, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('loopback login: rejects wrong state, exchanges PKCE code, saves a private access token', { timeout: 30_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pangol-login-'))
  await mkdir(join(root, 'scripts'))
  await cp(new URL('../scripts/login.mjs', import.meta.url), join(root, 'scripts/login.mjs'))
  const env: NodeJS.ProcessEnv = { ...process.env, KEYCLOAK_ISSUER: 'http://127.0.0.1:8080/realms/pangol-demo', KEYCLOAK_CLIENT_ID: 'pangol-cli' }
  delete env.NODE_TEST_CONTEXT
  const child = spawn(process.execPath, [join(root, 'scripts/login.mjs')], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  const exited = new Promise<number | null>(resolve => child.once('exit', resolve))
  try {
    const authorization = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Login helper did not start')), 5000)
      let output = ''
      child.stdout.on('data', chunk => {
        output += chunk
        const url = /http:\/\/127\.0\.0\.1:8080\/[^\s]+/.exec(output)?.[0]
        if (url) { clearTimeout(timer); resolve(url) }
      })
      child.once('error', error => { clearTimeout(timer); reject(error) })
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Login helper exited before startup')) })
    })
    assert.equal((await fetch('http://127.0.0.1:8787/callback?state=wrong&code=fake')).status, 400)
    // Simulate only the fixture realm's login form; this never touches a real user's provider.
    const login = await fetch(authorization, { redirect: 'manual' })
    assert.equal(login.status, 200)
    const html = await login.text()
    const action = /<form[^>]*action="([^"]+)"/.exec(html)?.[1]?.replaceAll('&amp;', '&')
    assert.ok(action)
    assert.equal(new URL(action).origin, 'http://127.0.0.1:8080')
    const cookies = login.headers.getSetCookie().map(c => c.split(';')[0]).join('; ')
    const result = await fetch(action, { method: 'POST', redirect: 'manual', headers: { cookie: cookies },
      body: new URLSearchParams({ username: 'alice', password: 'demo-local-only', credentialId: '' }),
    })
    assert.equal(result.status, 302)
    const callback = result.headers.get('location')
    assert.ok(callback)
    assert.equal(new URL(callback).origin, 'http://127.0.0.1:8787')
    assert.equal((await fetch(callback)).status, 200)
    assert.equal(await exited, 0)
    const file = join(root, '.local/token.json')
    const saved = JSON.parse(await readFile(file, 'utf8')) as { accessToken: string; expiresAt: number }
    assert.ok(saved.expiresAt > Date.now())
    assert.equal((await stat(file)).mode & 0o777, 0o600)
    const user = await fetch('http://127.0.0.1:8080/realms/pangol-demo/protocol/openid-connect/userinfo', { headers: { authorization: `Bearer ${saved.accessToken}` } })
    assert.equal(user.status, 200)
    assert.equal((await user.json() as { preferred_username: string }).preferred_username, 'alice')
  } finally {
    if (child.exitCode === null) { child.kill(); await exited }
    await rm(root, { recursive: true, force: true })
  }
})
