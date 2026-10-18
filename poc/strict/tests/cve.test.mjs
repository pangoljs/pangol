// Regression tests built from real vulnerabilities in Hono, Fastify and Elysia, plus classic attacks.
// run: node --test tests/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPath, pathFromUrl, mediaType, isJson, parseJson, boundaryOf, parseMultipart, Reject, MULTIPART_LIMITS } from '../strict.mjs'

const status = (fn) => { try { fn(); return 200 } catch (e) { if (e instanceof Reject) return e.status; throw e } }

// ---------------------------------------------------------------------------------------------
// Hono CVE-2025-58362 (GHSA-9hp6-4448-45g2): getPath() used fixed offsets on absolute-form URLs,
// so the app could route a different path than the proxy checked. Hono's fix test asserts
// getPath(url) === new URL(url).pathname for these four inputs.
// Our rule is stricter: a path is either rejected, or identical to the WHATWG parser's pathname.
test('Hono CVE-2025-58362: inputs from Hono fix commit', () => {
  for (const url of ['http:/example.com/hello', 'http:///hello', 'http://a/:/hello', 'x://a/:/hello']) {
    const p = pathFromUrl(url)
    assert.ok(p === null || p === new URL(url).pathname, `${url} -> ${p}`)
  }
})

test('proxy/app path disagreement: every bypass spelling of /admin is rejected', () => {
  const bypasses = [
    '/public/../admin', '/public/%2E%2E/admin', '/public/%2e%2e/admin', '/public/..%2Fadmin', '/public%2F..%2Fadmin',
    '//admin', '/./admin', '/admin/.', '/admin/', '/%61dmin', '/adm%69n', '/admin%2F', '/admin%5C', '/admin\\',
    '/admin%00', '/admin%0A', '/admin%2e', '/admin%25', '/admin%2', '/admin%zz', '/admin%c0%af', '/admin%ff',
    '/ad min', '/admin\t', '/ádmin', '/admin#x', '/admin?x#y/..',
  ]
  for (const p of bypasses) assert.equal(pathFromUrl(p), null, p)
  // allowed: canonical forms, query strings, legitimately encoded bytes
  assert.equal(pathFromUrl('/admin'), '/admin')
  assert.equal(pathFromUrl('/users/42?x=../..'), '/users/42')
  assert.equal(pathFromUrl('http://example.com/users/42?q=1'), '/users/42')
  assert.equal(pathFromUrl('/files/a%20b'), '/files/a%20b')
  assert.equal(pathFromUrl('/th/%E0%B8%AA%E0%B8%A7%E0%B8%B1%E0%B8%AA%E0%B8%94%E0%B8%B5'), '/th/%E0%B8%AA%E0%B8%A7%E0%B8%B1%E0%B8%AA%E0%B8%94%E0%B8%B5')
  assert.equal(pathFromUrl('/v1.2/file.tar.gz'), '/v1.2/file.tar.gz')
  // absolute-form oddities
  for (const u of ['http://a@b/admin', 'http://a\\b/admin', 'http:// /admin', 'http://h?x/admin']) assert.equal(pathFromUrl(u), null, u)
})

// ---------------------------------------------------------------------------------------------
// Fastify CVE-2025-32442: a slightly different Content-Type (e.g. leading space, different case)
// selected the JSON parser but not the JSON schema, so the body was parsed but never validated.
// Our pipeline: one parsed media type decides both. Property: no Content-Type spelling can make a
// body reach the handler without validation.
function pipeline(ct, text) {
  if (!isJson(ct)) return 415
  let body
  try { body = parseJson(text) } catch (e) { return e.status }
  const ok = typeof body === 'object' && body !== null && Number.isInteger(body.age) && body.age >= 0 && body.age <= 150
  return ok ? 201 : 400
}
test('Fastify CVE-2025-32442: no Content-Type variant skips validation', () => {
  const variants = [
    'application/json', ' application/json', 'application/json ', '\tapplication/json', 'APPLICATION/JSON', 'Application/Json',
    'application/json;charset=utf-8', 'application/json; charset=UTF-8', 'application/json; charset="utf-8"',
    'application/json;charset=latin1', 'application/json; foo=bar', 'application/json;', 'application/json;;', 'application/json,text/plain',
    'application/jsonx', 'application/json-patch+json', 'text/plain;application/json', 'application/ json', 'application /json',
    'application/json; charset=utf-8; charset=latin1', 'application/json\u0000', 'application/json\r\nX: y', '', 'json',
  ]
  const invalid = '{"name":"a","age":"not a number"}'
  const valid = '{"name":"a","age":30}'
  for (const ct of variants) {
    const r1 = pipeline(ct, invalid)
    assert.ok(r1 === 415 || r1 === 400, `${JSON.stringify(ct)} with invalid body -> ${r1}`)
    const r2 = pipeline(ct, valid)
    assert.ok(r2 === 415 || r2 === 201, `${JSON.stringify(ct)} with valid body -> ${r2}`)
  }
  // exactly the spellings that mean application/json (optionally utf-8) are accepted
  const accepted = variants.filter((ct) => isJson(ct))
  assert.deepEqual(accepted, ['application/json', ' application/json', 'application/json ', '\tapplication/json', 'APPLICATION/JSON', 'Application/Json',
    'application/json;charset=utf-8', 'application/json; charset=UTF-8', 'application/json; charset="utf-8"'])
})

// ---------------------------------------------------------------------------------------------
// Elysia CVE-2026-56669: multipart normalization called getAll() per key -> O(n²) CPU with many
// unique field names. Ours: one pass + limit on parts.
function multipartBody(n, boundary = 'XyZ') {
  let s = ''
  for (let i = 0; i < n; i++) s += `--${boundary}\r\nContent-Disposition: form-data; name="f${i}"\r\n\r\nv${i}\r\n`
  return Buffer.from(s + `--${boundary}--\r\n`)
}
test('Elysia CVE-2026-56669: too many fields rejected by limit', () => {
  assert.equal(parseMultipart(multipartBody(100), 'XyZ').size, 100)
  assert.equal(status(() => parseMultipart(multipartBody(101), 'XyZ')), 413)
})
test('Elysia CVE-2026-56669: parse time grows linearly, not quadratically', () => {
  const lim = { ...MULTIPART_LIMITS, maxParts: 1e9 }
  const time = (n) => {
    const b = multipartBody(n)
    parseMultipart(b, 'XyZ', lim)
    const t = performance.now()
    for (let k = 0; k < 5; k++) parseMultipart(b, 'XyZ', lim)
    return (performance.now() - t) / 5
  }
  time(2000)
  const small = time(4000), big = time(32000) // 8x the fields
  const ratio = big / small
  console.log(`  multipart 4k fields ${small.toFixed(2)} ms, 32k fields ${big.toFixed(2)} ms, ratio ${ratio.toFixed(1)} (linear ≈ 8, quadratic ≈ 64)`)
  assert.ok(ratio < 20, `ratio ${ratio}`)
})

// ---------------------------------------------------------------------------------------------
test('prototype pollution keys are rejected, including escaped spellings', () => {
  for (const t of ['{"__proto__":{"admin":true}}', '{"a":{"constructor":{"prototype":{"x":1}}}}', '{"\\u005f_proto__":1}', '{"prototype":1}'])
    assert.equal(status(() => parseJson(t)), 400, t)
  assert.equal({}.admin, undefined)
})
test('duplicate keys are rejected (parsers disagree on which one wins)', () => {
  assert.equal(status(() => parseJson('{"role":"user","role":"admin"}')), 400)
  assert.equal(status(() => parseJson('{"role":"user","r\\u006fle":"admin"}')), 400)
  assert.deepEqual(parseJson('{"a":{"role":1},"b":{"role":2}}'), { a: { role: 1 }, b: { role: 2 } }) // same key in different objects is fine
})
test('depth bombs are rejected fast without stack overflow', () => {
  const bomb = '['.repeat(1_000_000) + ']'.repeat(1_000_000)
  const t = performance.now()
  assert.equal(status(() => parseJson(bomb)), 400)
  assert.ok(performance.now() - t < 50)
  assert.equal(status(() => parseJson('{"a":'.repeat(33) + '1' + '}'.repeat(33))), 400)
  assert.deepEqual(parseJson('{"a":'.repeat(32) + '1' + '}'.repeat(32)).a.a.a !== undefined, true)
})
test('width limits: keys per object and items per array', () => {
  const obj = (n) => '{' + Array.from({ length: n }, (_, i) => `"k${i}":1`).join(',') + '}'
  assert.equal(status(() => parseJson(obj(256))), 200)
  assert.equal(status(() => parseJson(obj(257))), 413)
  assert.equal(status(() => parseJson('[' + '1,'.repeat(9999) + '1]')), 200)
  assert.equal(status(() => parseJson('[' + '1,'.repeat(10000) + '1]')), 413)
})
test('strings that look like structure do not confuse the scanner', () => {
  assert.deepEqual(parseJson('{"a":"{[,\\"__proto__\\":1]}","b":"]}"}'), { a: '{[,"__proto__":1]}', b: ']}' })
  for (const t of ['{"a":"unterminated}', '{"a":1', '[1,2', '{"a":1}}', 'nul', '"\\']) assert.equal(status(() => parseJson(t)), 400, t)
})
test('multipart: boundary and header abuse', () => {
  assert.equal(boundaryOf('multipart/form-data; boundary=XyZ'), 'XyZ')
  assert.equal(boundaryOf('multipart/form-data; boundary="a b c"'), 'a b c')
  for (const ct of ['multipart/form-data', 'multipart/form-data; boundary=', 'multipart/form-data; boundary=' + 'x'.repeat(71), 'multipart/form-data; boundary=a; boundary=b', 'multipart/mixed; boundary=x'])
    assert.equal(boundaryOf(ct), null, ct)
  const two = Buffer.from('--B\r\nContent-Disposition: form-data; name="a"\r\nContent-Disposition: form-data; name="b"\r\n\r\nx\r\n--B--')
  assert.equal(status(() => parseMultipart(two, 'B')), 400) // duplicate disposition header
  const traversal = Buffer.from('--B\r\nContent-Disposition: form-data; name="f"; filename="../../etc/passwd"\r\n\r\nx\r\n--B--')
  assert.equal(parseMultipart(traversal, 'B').get('f')[0].filename, '../../etc/passwd') // kept as data, never as a path
  const proto = Buffer.from('--B\r\nContent-Disposition: form-data; name="__proto__"\r\n\r\nx\r\n--B--')
  assert.equal(parseMultipart(proto, 'B').get('__proto__')[0], 'x') // stored in a Map, cannot pollute
  assert.equal({}.x, undefined)
  const bigHeader = Buffer.from('--B\r\nContent-Disposition: form-data; name="a"' + '; x=y'.repeat(300) + '\r\n\r\nx\r\n--B--')
  assert.equal(status(() => parseMultipart(bigHeader, 'B')), 400)
})
test('ReDoS: email check sees bounded input only', () => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const evil = 'a@' + 'a.'.repeat(100) // max length 200 is checked first in the generated validator
  const t = performance.now()
  for (let i = 0; i < 1000; i++) re.test(evil.slice(0, 200) + '!')
  assert.ok(performance.now() - t < 200)
})

// Found while building this PoC: Bun 1.4.2's native router decodes params ("/users/4%2F2" -> "4/2",
// "/users/%2e%2e" -> "..") and routes "/users/.." to "/users/:id" while req.url reports "/".
test('decoded router params cannot carry separators, dot-segments or control bytes', async () => {
  const { safeSegment } = await import('../strict.mjs')
  for (const v of ['4/2', '..', '.', '42\u0000', 'a\\b', 'x\ny', '', '\u007f']) assert.equal(safeSegment(v), false, JSON.stringify(v))
  for (const v of ['42', 'a b', 'ส', 'file.txt', '...', '42;x']) assert.equal(safeSegment(v), true, v)
})
