// Property-based fuzzing, ported from poc/strict/tests/fuzz.test.mjs. Each property is an invariant
// that must hold for every input; fast-check generates random and adversarial inputs and shrinks a
// failure to a minimal counter-example. FUZZ_RUNS scales the cases (SPEC section 15: 20k per PR,
// 24 million nightly).
import fc from 'fast-check'
import { expect, it } from 'vitest'
import {
  JSON_LIMITS, Reject, isJson, mediaType, parseJson, parseMultipart, pathFromUrl, checkPath, validTarget,
} from '../../src/core/strict.js'

const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {}
const RUNS = Number(env['FUZZ_RUNS'] ?? 20_000)
const TIMEOUT = { timeout: Math.max(60_000, RUNS * 10) }
const attempt = (fn: () => unknown): { value?: unknown; reject?: Reject } => {
  try { return { value: fn() } } catch (e) { if (e instanceof Reject) return { reject: e }; throw e }
}
const bytes = (s: string) => new TextEncoder().encode(s)

// Characters chosen to hit every edge of the path rules.
const pathChar = fc.constantFrom('/', '/', '/', '.', '.', '%', '2', 'e', 'E', 'F', 'f', '5', 'C', 'a', 'z', '0', '9', '-', '_', '~',
  '\\', ';', ':', '@', '?', '#', ' ', '\t', '\u0000', '\n', 'é', 'ก', '😀', '"', '<', '`', '{', '^', '|', '+', '&', '=', "'", '(', '*', '!', '$', ',')
const pathish = fc.array(pathChar, { maxLength: 40 }).map((a) => a.join(''))
const percent = fc.integer({ min: 0, max: 255 }).map((b) => '%' + b.toString(16).toUpperCase().padStart(2, '0'))
const segment = fc.array(fc.oneof(fc.constantFrom('a', 'Z', '0', '.', '-', '_', '~', '!', ':', '@', '+', ','), percent), { minLength: 1, maxLength: 6 }).map((a) => a.join(''))
const structured = fc.array(segment, { minLength: 1, maxLength: 6 }).map((s) => '/' + s.join('/'))

it('path: anything accepted is exactly what a standard URL parser sees', TIMEOUT, () => {
  fc.assert(fc.property(fc.oneof(pathish.map((s) => '/' + s), pathish, structured, fc.string()), (p) => {
    const r = checkPath(p)
    if (r === null) return
    expect(r).toBe(p)
    // differential: the WHATWG URL parser (what proxies, browsers and runtimes use) leaves it unchanged
    expect(new URL(p, 'http://x').pathname).toBe(p)
    // decoded segments contain no separators, NUL or dot-segments
    for (const s of p.split('/').slice(1)) {
      const d = decodeURIComponent(s)
      expect(!d.includes('/') && !d.includes('\\') && !d.includes('\0') && d !== '.' && d !== '..', s).toBe(true)
    }
    expect(checkPath(r)).toBe(r) // idempotent
  }), { numRuns: RUNS * 5 })
})

it('path: absolute-form URLs agree with new URL().pathname or are rejected', TIMEOUT, () => {
  const scheme = fc.constantFrom('http', 'https', 'x', 'http+unix', 'h')
  const sep = fc.constantFrom('://', ':/', ':///', '://')
  const host = fc.constantFrom('a', 'example.com', '', 'a@b', 'a:1', '%2F', 'a\\b', ' ')
  fc.assert(fc.property(scheme, sep, host, fc.oneof(pathish, structured), (s, sp, h, p) => {
    const url = s + sp + h + p
    const r = pathFromUrl(url)
    expect(validTarget(url), `validTarget disagrees on ${url}`).toBe(r !== null)
    const known = 'http://localhost:3000' + p // also exercise the cached-prefix fast path
    expect(validTarget(known), known).toBe(pathFromUrl(known) !== null)
    if (pathFromUrl(known) !== null) expect(pathFromUrl(known)).toBe(new URL(known).pathname)
    if (r === null) return
    expect(() => new URL(url), `accepted ${url} that URL() cannot parse`).not.toThrow()
    expect(r, url).toBe(new URL(url).pathname)
  }), { numRuns: RUNS * 5 })
})

const ctChar = fc.constantFrom('a', 'p', 'l', 'i', 'c', 't', 'o', 'n', 'j', 's', '/', ';', '=', ' ', '\t', '"', '\\', ',', 'A', 'J', '-', '+', '8', 'u', 'f', '\u0000', '\r', '\n', 'é')
it('content-type: never throws; the JSON verdict depends only on the canonical media type', TIMEOUT, () => {
  const variants = fc.tuple(
    fc.constantFrom('', ' ', '\t', '  '),
    fc.constantFrom('application/json', 'APPLICATION/JSON', 'Application/Json', 'application/jsonx', 'text/json', 'application/json-seq'),
    fc.constantFrom('', ' ', '\t'),
    fc.constantFrom('', ';charset=utf-8', '; charset=UTF-8', '; charset="utf-8"', ';', '; a=b', ';charset=latin1', ',x', '; charset=utf-8; charset=utf-8'),
  ).map((a) => a.join(''))
  fc.assert(fc.property(fc.oneof(fc.array(ctChar, { maxLength: 40 }).map((a) => a.join('')), variants, fc.string()), (ct) => {
    const m = mediaType(ct)
    if (m !== null) expect(m.type).toMatch(/^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/)
    if (!isJson(ct)) return
    // accepted only when the media type is exactly application/json and the only param is charset=utf-8
    expect(m?.type).toBe('application/json')
    expect(Object.entries(m?.params ?? {}).every(([k, v]) => k === 'charset' && v.toLowerCase() === 'utf-8')).toBe(true)
    expect(ct).toMatch(/^[ \t]*application\/json/i)
  }), { numRuns: RUNS * 5 })
})

const depthOf = (v: unknown): number => (v !== null && typeof v === 'object' ? 1 + Math.max(0, ...Object.values(v).map(depthOf)) : 0)
const badKeys = (v: unknown): boolean => v !== null && typeof v === 'object' &&
  (Object.keys(v).some((k) => k === '__proto__' || k === 'constructor' || k === 'prototype') || Object.values(v).some(badKeys))

it('json: agrees with JSON.parse on valid documents and rejects only for a stated reason', TIMEOUT, () => {
  const key = fc.oneof(fc.string({ maxLength: 4 }), fc.constantFrom('__proto__', 'constructor', 'prototype', 'a', '"', '\\', '{', '[', ','))
  const { tree } = fc.letrec<{ tree: unknown }>((tie) => ({
    tree: fc.oneof({ depthSize: 'small', withCrossShrink: true }, fc.constant(null), fc.boolean(), fc.double({ noNaN: true, noDefaultInfinity: true }),
      fc.string({ maxLength: 6 }), fc.array(tie('tree'), { maxLength: 4 }), fc.dictionary(key, tie('tree'), { maxKeys: 4 })),
  }))
  fc.assert(fc.property(tree, fc.integer({ min: 0, max: 40 }), (value, wrap) => {
    let v = value
    for (let i = 0; i < wrap; i++) v = [v] // push some documents past the depth limit
    const text = JSON.stringify(v)
    const r = attempt(() => parseJson(text))
    if (r.reject) {
      const code = r.reject.code
      if (code === 'too_deep') expect(depthOf(v)).toBeGreaterThan(JSON_LIMITS.maxDepth)
      else if (code === 'forbidden_key') expect(text.includes('__proto__') || badKeys(v)).toBe(true)
      else expect.fail(`unexpected reject ${code} for ${text.slice(0, 200)}`)
    } else {
      expect(depthOf(v)).toBeLessThanOrEqual(JSON_LIMITS.maxDepth)
      expect(r.value).toEqual(JSON.parse(text))
    }
  }), { numRuns: RUNS })
})

it('json: random text never crashes; accepted text is valid JSON', TIMEOUT, () => {
  const jsonChar = fc.constantFrom('{', '}', '[', ']', '"', '\\', ',', ':', '1', 'a', 'u', '0', ' ', 't', 'r', 'e', 'n', 'l', '_', 'p')
  fc.assert(fc.property(fc.oneof(fc.array(jsonChar, { maxLength: 60 }).map((a) => a.join('')), fc.string()), (text) => {
    const r = attempt(() => parseJson(text))
    if (!r.reject) expect(r.value).toEqual(JSON.parse(text))
  }), { numRuns: RUNS * 5 })
})

it('multipart: round-trips random fields; random bytes never crash', TIMEOUT, () => {
  const name = fc.stringMatching(/^[a-zA-Z0-9_-]{1,10}$/)
  const value = fc.string({ maxLength: 30 }).filter((s) => !s.includes('--B'))
  fc.assert(fc.property(fc.array(fc.tuple(name, value), { maxLength: 20 }), (pairs) => {
    let s = ''
    for (const [n, v] of pairs) s += `--B\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`
    const expected = new Map<string, string[]>()
    for (const [n, v] of pairs) expected.set(n, [...(expected.get(n) ?? []), v])
    expect(parseMultipart(bytes(s + '--B--\r\n'), 'B')).toEqual(expected)
  }), { numRuns: RUNS })
  const piece = fc.constantFrom('--B', '\r\n', '\r\n\r\n', 'Content-Disposition: form-data; name="a"', 'filename="x"', ':', ';', '"', '--', 'x')
  fc.assert(fc.property(fc.array(fc.oneof(piece, fc.string({ maxLength: 5 })), { maxLength: 30 }), (a) => {
    attempt(() => parseMultipart(bytes(a.join('')), 'B'))
  }), { numRuns: RUNS * 2 })
})
