// Property-based fuzzing (fast-check). Each property states an invariant that must hold for
// every input, then fast-check generates random and adversarial inputs and shrinks any failure
// to a minimal counter-example.  FUZZ_RUNS env var scales the number of cases.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fc from 'fast-check'
import { checkPath, pathFromUrl, validTarget, mediaType, isJson, parseJson, parseMultipart, Reject, JSON_LIMITS } from '../strict.mjs'

const RUNS = Number(process.env.FUZZ_RUNS ?? 20000)
const ok = (fn) => { try { return { v: fn() } } catch (e) { if (e instanceof Reject) return { reject: e }; throw e } }

// Characters chosen to hit every edge of the path rules.
const pathChar = fc.constantFrom('/', '/', '/', '.', '.', '%', '2', 'e', 'E', 'F', 'f', '5', 'C', 'a', 'z', '0', '9', '-', '_', '~',
  '\\', ';', ':', '@', '?', '#', ' ', '\t', '\u0000', '\n', 'é', 'ก', '😀', '"', '<', '`', '{', '^', '|', '+', '&', '=', "'", '(', '*', '!', '$', ',')
const pathish = fc.array(pathChar, { maxLength: 40 }).map((a) => a.join(''))
const percent = fc.integer({ min: 0, max: 255 }).map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
const segment = fc.array(fc.oneof(fc.constantFrom('a', 'Z', '0', '.', '-', '_', '~', '!', ':', '@', '+', ','), percent), { minLength: 1, maxLength: 6 }).map((a) => a.join(''))
const structured = fc.array(segment, { minLength: 1, maxLength: 6 }).map((s) => '/' + s.join('/'))

test('path: never throws; anything accepted is exactly what a standard URL parser sees', () => {
  fc.assert(fc.property(fc.oneof(pathish.map((s) => '/' + s), pathish, structured, fc.string()), (p) => {
    const r = checkPath(p)
    if (r === null) return true
    assert.equal(r, p)
    // 1) differential: the WHATWG URL parser (what proxies, browsers and runtimes use) leaves it unchanged
    assert.equal(new URL(p, 'http://x').pathname, p)
    // 2) decoded segments contain no separators, NUL or dot-segments
    for (const s of p.split('/').slice(1)) {
      const d = decodeURIComponent(s)
      assert.ok(!d.includes('/') && !d.includes('\\') && !d.includes('\0') && d !== '.' && d !== '..', s)
    }
    // 3) idempotent
    assert.equal(checkPath(r), r)
    return true
  }), { numRuns: RUNS * 5 })
})

test('path: absolute-form URLs agree with new URL().pathname or are rejected', () => {
  const scheme = fc.constantFrom('http', 'https', 'x', 'http+unix', 'h')
  const sep = fc.constantFrom('://', ':/', ':///', '://')
  const host = fc.constantFrom('a', 'example.com', '', 'a@b', 'a:1', '%2F', 'a\\b', ' ')
  fc.assert(fc.property(scheme, sep, host, fc.oneof(pathish, structured), (s, sp, h, p) => {
    const url = s + sp + h + p
    const r = pathFromUrl(url)
    assert.equal(validTarget(url), r !== null, `validTarget disagrees on ${url}`)
    const known = 'http://localhost:3000' + p // also exercise the cached-prefix fast path
    assert.equal(validTarget(known), pathFromUrl(known) !== null, known)
    if (pathFromUrl(known) !== null) assert.equal(pathFromUrl(known), new URL(known).pathname)
    if (r === null) return true
    let parsed
    try { parsed = new URL(url).pathname } catch { assert.fail(`accepted ${url} that URL() cannot parse`) }
    assert.equal(r, parsed, url)
    return true
  }), { numRuns: RUNS * 5 })
})

const ctChar = fc.constantFrom('a', 'p', 'l', 'i', 'c', 't', 'o', 'n', 'j', 's', '/', ';', '=', ' ', '\t', '"', '\\', ',', 'A', 'J', '-', '+', '8', 'u', 'f', '\u0000', '\r', '\n', 'é')
test('content-type: never throws; JSON verdict depends only on the canonical media type', () => {
  const variants = fc.tuple(fc.constantFrom('', ' ', '\t', '  '), fc.constantFrom('application/json', 'APPLICATION/JSON', 'Application/Json', 'application/jsonx', 'text/json', 'application/json-seq'),
    fc.constantFrom('', ' ', '\t'), fc.constantFrom('', ';charset=utf-8', '; charset=UTF-8', '; charset="utf-8"', ';', '; a=b', ';charset=latin1', ',x', '; charset=utf-8; charset=utf-8')).map((a) => a.join(''))
  fc.assert(fc.property(fc.oneof(fc.array(ctChar, { maxLength: 40 }).map((a) => a.join('')), variants, fc.string()), (ct) => {
    const m = mediaType(ct)
    if (m !== null) assert.match(m.type, /^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/)
    if (isJson(ct)) {
      // accepted only when the media type is exactly application/json and the only param is charset=utf-8
      assert.equal(m.type, 'application/json')
      assert.ok(Object.keys(m.params).every((k) => k === 'charset' && m.params[k].toLowerCase() === 'utf-8'))
      assert.ok(/^[ \t]*application\/json/i.test(ct))
    }
    return true
  }), { numRuns: RUNS * 5 })
})

const depthOf = (v) => (v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depthOf)) : 0)
const badKeys = (v) => v !== null && typeof v === 'object' && (Object.keys(v).some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype') || Object.values(v).some(badKeys))
test('json: agrees with JSON.parse on valid documents, rejects only for a stated reason', () => {
  const key = fc.oneof(fc.string({ maxLength: 4 }), fc.constantFrom('__proto__', 'constructor', 'prototype', 'a', '"', '\\', '{', '[', ','))
  const { tree } = fc.letrec((tie) => ({
    tree: fc.oneof({ depthSize: 'small', withCrossShrink: true }, fc.constant(null), fc.boolean(), fc.double({ noNaN: true, noDefaultInfinity: true }), fc.string({ maxLength: 6 }),
      fc.array(tie('tree'), { maxLength: 4 }), fc.dictionary(key, tie('tree'), { maxKeys: 4 })),
  }))
  fc.assert(fc.property(tree, fc.integer({ min: 0, max: 40 }), (v, wrap) => {
    for (let i = 0; i < wrap; i++) v = [v] // push some documents past the depth limit
    const text = JSON.stringify(v)
    const r = ok(() => parseJson(text))
    if (r.reject) {
      const c = r.reject.code
      if (c === 'too_deep') assert.ok(depthOf(v) > JSON_LIMITS.maxDepth)
      else if (c === 'forbidden_key') assert.ok(text.includes('__proto__') || badKeys(v))
      else assert.fail(`unexpected reject ${c} for ${text.slice(0, 200)}`)
    } else {
      assert.ok(depthOf(v) <= JSON_LIMITS.maxDepth)
      assert.deepEqual(r.v, JSON.parse(text))
    }
    return true
  }), { numRuns: RUNS })
})

test('json: random text never crashes; accepted text is valid JSON', () => {
  const jsonChar = fc.constantFrom('{', '}', '[', ']', '"', '\\', ',', ':', '1', 'a', 'u', '0', ' ', 't', 'r', 'e', 'n', 'l', '_', 'p')
  fc.assert(fc.property(fc.oneof(fc.array(jsonChar, { maxLength: 60 }).map((a) => a.join('')), fc.string()), (t) => {
    const r = ok(() => parseJson(t))
    if (!r.reject) assert.deepEqual(r.v, JSON.parse(t))
    return true
  }), { numRuns: RUNS * 5 })
})

test('multipart: round-trips random fields; random bytes never crash', () => {
  const name = fc.stringMatching(/^[a-zA-Z0-9_-]{1,10}$/)
  const value = fc.string({ maxLength: 30 }).filter((s) => !s.includes('--B'))
  fc.assert(fc.property(fc.array(fc.tuple(name, value), { maxLength: 20 }), (pairs) => {
    let s = ''
    for (const [n, v] of pairs) s += `--B\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`
    const fields = parseMultipart(Buffer.from(s + '--B--\r\n'), 'B')
    const expect = new Map()
    for (const [n, v] of pairs) expect.set(n, [...(expect.get(n) ?? []), v])
    assert.deepEqual(fields, expect)
    return true
  }), { numRuns: RUNS })
  const piece = fc.constantFrom('--B', '\r\n', '\r\n\r\n', 'Content-Disposition: form-data; name="a"', 'filename="x"', ':', ';', '"', '--', 'x')
  fc.assert(fc.property(fc.array(fc.oneof(piece, fc.string({ maxLength: 5 })), { maxLength: 30 }), (a) => {
    ok(() => parseMultipart(Buffer.from(a.join('')), 'B'))
    return true
  }), { numRuns: RUNS * 2 })
})
