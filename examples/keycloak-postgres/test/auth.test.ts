import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generateKeyPair, exportJWK, SignJWT } from 'jose'
import { tokenVerifier } from '../src/token.js'

test('JWT trust boundary: signature, claims, token kind, client roles and rotated keys', async () => {
  const first = await generateKeyPair('RS256')
  const second = await generateKeyPair('RS256')
  const foreign = await generateKeyPair('RS256')
  const keys = [ { ...await exportJWK(first.publicKey), kid: 'first', alg: 'RS256', use: 'sig' } ]
  let calls = 0
  const server = createServer((req, res) => {
    assert.equal(req.url, '/realms/test/protocol/openid-connect/certs')
    calls++
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ keys }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const issuer = `http://127.0.0.1:${(server.address() as { port: number }).port}/realms/test`
  const verify = tokenVerifier(issuer, 'pangol-api', 0) // no refresh cooldown in this deterministic test
  const claims = { iss: issuer, aud: 'pangol-api', sub: 'alice', exp: Math.floor(Date.now() / 1000) + 60,
    iat: Math.floor(Date.now() / 1000), typ: 'Bearer', resource_access: { 'pangol-api': { roles: ['posts:write', 'ignored'] } } }
  const sign = (patch: object = {}, key = first.privateKey, kid = 'first') =>
    new SignJWT({ ...claims, ...patch }).setProtectedHeader({ alg: 'RS256', kid }).sign(key)
  try {
    assert.deepEqual(await verify(await sign()), { issuer, subject: 'alice', permissions: ['posts:write'] })
    assert.equal(calls, 1)
    assert.ok(await verify(await sign({ aud: ['other', 'pangol-api'] })))
    for (const patch of [{ iss: issuer + '-wrong' }, { aud: 'other-api' }, { exp: 1 }, { exp: undefined },
      { sub: undefined }, { sub: '' }, { iat: undefined }, { iat: 'wrong' }, { iat: claims.exp + 60 }, { typ: 'ID' }, { nbf: claims.exp + 60 }]) {
      assert.equal(await verify(await sign(patch)), null, JSON.stringify(patch))
    }
    assert.equal(await verify(await sign({}, foreign.privateKey)), null)
    assert.equal(await verify('not-a-token'), null)
    assert.deepEqual((await verify(await sign({ resource_access: { other: { roles: ['posts:write'] } }, realm_access: { roles: ['posts:write'] } })))?.permissions, [])
    assert.deepEqual((await verify(await sign({ resource_access: { 'pangol-api': { roles: 'posts:write' } } })))?.permissions, [])
    keys.push({ ...await exportJWK(second.publicKey), kid: 'second', alg: 'RS256', use: 'sig' })
    // The same verifier refreshes its cached JWKS when a new key ID appears.
    assert.ok(await verify(await sign({}, second.privateKey, 'second')))
    assert.equal(await verify(await new SignJWT(claims).setProtectedHeader({ alg: 'HS256' }).sign(new Uint8Array(32))), null)
    assert.equal(await verify(await sign({}, second.privateKey, 'unknown')), null)
  } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())) }
  assert.equal(await tokenVerifier(issuer, 'pangol-api')(await sign()), null, 'unavailable JWKS fails closed')
})

test('remote issuer requires HTTPS; local demo is explicit loopback', () => {
  for (const issuer of ['http://example.com/realms/demo', 'https://user:pass@example.com/realm', 'https://example.com/realm?x=1']) {
    assert.throws(() => tokenVerifier(issuer, 'api'))
  }
  assert.throws(() => tokenVerifier('https://example.com/realms/demo', ''))
  assert.doesNotThrow(() => tokenVerifier('https://example.com/realms/demo', 'api'))
})
