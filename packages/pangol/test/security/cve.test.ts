// Regression tests built from real vulnerabilities in Hono, Fastify and Elysia, plus classic attacks.
// Ported from poc/strict/tests/cve.test.mjs; the cases are unchanged.
import { describe, expect, it } from 'vitest'
import {
  MULTIPART_LIMITS, Reject, boundaryOf, isJson, parseJson, parseMultipart, pathFromUrl, safeSegment,
} from '../../src/core/strict.js'

const status = (fn: () => unknown): number => {
  try { fn(); return 200 } catch (e) { if (e instanceof Reject) return e.status; throw e }
}
const bytes = (s: string) => new TextEncoder().encode(s)

// Hono CVE-2025-58362 (GHSA-9hp6-4448-45g2): getPath() used fixed offsets on absolute-form URLs,
// so the app could route a different path than the proxy checked. Our rule is stricter: a path is
// either rejected, or identical to the WHATWG parser's pathname.
describe('Hono CVE-2025-58362: proxy and app must agree on the path', () => {
  it('handles the inputs from the Hono fix commit', () => {
    for (const url of ['http:/example.com/hello', 'http:///hello', 'http://a/:/hello', 'x://a/:/hello']) {
      const p = pathFromUrl(url)
      expect(p === null || p === new URL(url).pathname, `${url} -> ${p}`).toBe(true)
    }
  })

  it('rejects every bypass spelling of /admin', () => {
    const bypasses = [
      '/public/../admin', '/public/%2E%2E/admin', '/public/%2e%2e/admin', '/public/..%2Fadmin', '/public%2F..%2Fadmin',
      '//admin', '/./admin', '/admin/.', '/admin/', '/%61dmin', '/adm%69n', '/admin%2F', '/admin%5C', '/admin\\',
      '/admin%00', '/admin%0A', '/admin%2e', '/admin%25', '/admin%2', '/admin%zz', '/admin%c0%af', '/admin%ff',
      '/ad min', '/admin\t', '/ádmin', '/admin#x', '/admin?x#y/..',
    ]
    for (const p of bypasses) expect(pathFromUrl(p), p).toBeNull()
    for (const u of ['http://a@b/admin', 'http://a\\b/admin', 'http:// /admin', 'http://h?x/admin']) expect(pathFromUrl(u), u).toBeNull()
  })

  it('accepts canonical paths, query strings and legitimately encoded bytes', () => {
    expect(pathFromUrl('/admin')).toBe('/admin')
    expect(pathFromUrl('/users/42?x=../..')).toBe('/users/42')
    expect(pathFromUrl('http://example.com/users/42?q=1')).toBe('/users/42')
    expect(pathFromUrl('/files/a%20b')).toBe('/files/a%20b')
    const thai = '/th/%E0%B8%AA%E0%B8%A7%E0%B8%B1%E0%B8%AA%E0%B8%94%E0%B8%B5'
    expect(pathFromUrl(thai)).toBe(thai)
    expect(pathFromUrl('/v1.2/file.tar.gz')).toBe('/v1.2/file.tar.gz')
  })
})

// Fastify CVE-2025-32442: a slightly different Content-Type selected the JSON parser but not the
// JSON schema, so the body was parsed but never validated. Here one parsed media type decides both.
describe('Fastify CVE-2025-32442: no Content-Type spelling skips validation', () => {
  const pipeline = (ct: string, text: string): number => {
    if (!isJson(ct)) return 415
    let body: unknown
    try { body = parseJson(text) } catch (e) { if (e instanceof Reject) return e.status; throw e }
    const age = typeof body === 'object' && body !== null ? (body as { age?: unknown }).age : undefined
    return Number.isInteger(age) && (age as number) >= 0 && (age as number) <= 150 ? 201 : 400
  }
  const variants = [
    'application/json', ' application/json', 'application/json ', '\tapplication/json', 'APPLICATION/JSON', 'Application/Json',
    'application/json;charset=utf-8', 'application/json; charset=UTF-8', 'application/json; charset="utf-8"',
    'application/json;charset=latin1', 'application/json; foo=bar', 'application/json;', 'application/json;;', 'application/json,text/plain',
    'application/jsonx', 'application/json-patch+json', 'text/plain;application/json', 'application/ json', 'application /json',
    'application/json; charset=utf-8; charset=latin1', 'application/json\u0000', 'application/json\r\nX: y', '', 'json',
  ]

  it('validates or refuses every variant', () => {
    for (const ct of variants) {
      expect([415, 400], JSON.stringify(ct)).toContain(pipeline(ct, '{"name":"a","age":"not a number"}'))
      expect([415, 201], JSON.stringify(ct)).toContain(pipeline(ct, '{"name":"a","age":30}'))
    }
  })

  it('accepts exactly the spellings that mean application/json (optionally utf-8)', () => {
    expect(variants.filter((ct) => isJson(ct))).toEqual([
      'application/json', ' application/json', 'application/json ', '\tapplication/json', 'APPLICATION/JSON', 'Application/Json',
      'application/json;charset=utf-8', 'application/json; charset=UTF-8', 'application/json; charset="utf-8"',
    ])
  })
})

// Elysia CVE-2026-56669: multipart normalization called getAll() per key -> O(n²) CPU with many
// unique field names. Ours: one pass and a limit on parts.
describe('Elysia CVE-2026-56669: multipart stays linear and bounded', () => {
  const multipartBody = (n: number, boundary = 'XyZ') => {
    let s = ''
    for (let i = 0; i < n; i++) s += `--${boundary}\r\nContent-Disposition: form-data; name="f${i}"\r\n\r\nv${i}\r\n`
    return bytes(s + `--${boundary}--\r\n`)
  }

  it('rejects more parts than the limit', () => {
    expect(parseMultipart(multipartBody(100), 'XyZ').size).toBe(100)
    expect(status(() => parseMultipart(multipartBody(101), 'XyZ'))).toBe(413)
  })

  it('grows linearly, not quadratically, with the number of fields', () => {
    const limits = { ...MULTIPART_LIMITS, maxParts: 1e9 }
    const time = (n: number) => {
      const body = multipartBody(n)
      parseMultipart(body, 'XyZ', limits)
      const start = performance.now()
      for (let k = 0; k < 5; k++) parseMultipart(body, 'XyZ', limits)
      return (performance.now() - start) / 5
    }
    time(2000)
    const ratio = time(32000) / time(4000) // 8x the fields: linear ≈ 8, quadratic ≈ 64
    expect(ratio).toBeLessThan(20)
  })
})

describe('JSON', () => {
  it('rejects prototype pollution keys, including escaped spellings', () => {
    for (const text of ['{"__proto__":{"admin":true}}', '{"a":{"constructor":{"prototype":{"x":1}}}}', '{"\\u005f_proto__":1}', '{"prototype":1}']) {
      expect(status(() => parseJson(text)), text).toBe(400)
    }
    expect(({} as { admin?: unknown }).admin).toBeUndefined()
  })

  it('rejects duplicate keys (parsers disagree on which one wins)', () => {
    expect(status(() => parseJson('{"role":"user","role":"admin"}'))).toBe(400)
    expect(status(() => parseJson('{"role":"user","r\\u006fle":"admin"}'))).toBe(400)
    expect(parseJson('{"a":{"role":1},"b":{"role":2}}')).toEqual({ a: { role: 1 }, b: { role: 2 } })
  })

  it('rejects depth bombs fast without a stack overflow', () => {
    const bomb = '['.repeat(1_000_000) + ']'.repeat(1_000_000)
    const start = performance.now()
    expect(status(() => parseJson(bomb))).toBe(400)
    expect(performance.now() - start).toBeLessThan(50)
    expect(status(() => parseJson('{"a":'.repeat(33) + '1' + '}'.repeat(33)))).toBe(400)
    expect(status(() => parseJson('{"a":'.repeat(32) + '1' + '}'.repeat(32)))).toBe(200)
  })

  it('limits keys per object and items per array', () => {
    const obj = (n: number) => '{' + Array.from({ length: n }, (_, i) => `"k${i}":1`).join(',') + '}'
    expect(status(() => parseJson(obj(256)))).toBe(200)
    expect(status(() => parseJson(obj(257)))).toBe(413)
    expect(status(() => parseJson('[' + '1,'.repeat(9999) + '1]'))).toBe(200)
    expect(status(() => parseJson('[' + '1,'.repeat(10000) + '1]'))).toBe(413)
  })

  it('is not confused by strings that look like structure', () => {
    expect(parseJson('{"a":"{[,\\"__proto__\\":1]}","b":"]}"}')).toEqual({ a: '{[,"__proto__":1]}', b: ']}' })
    for (const text of ['{"a":"unterminated}', '{"a":1', '[1,2', '{"a":1}}', 'nul', '"\\']) expect(status(() => parseJson(text)), text).toBe(400)
  })
})

describe('multipart boundary and header abuse', () => {
  it('accepts only one valid boundary', () => {
    expect(boundaryOf('multipart/form-data; boundary=XyZ')).toBe('XyZ')
    expect(boundaryOf('multipart/form-data; boundary="a b c"')).toBe('a b c')
    for (const ct of ['multipart/form-data', 'multipart/form-data; boundary=', 'multipart/form-data; boundary=' + 'x'.repeat(71),
      'multipart/form-data; boundary=a; boundary=b', 'multipart/mixed; boundary=x']) expect(boundaryOf(ct), ct).toBeNull()
  })

  it('rejects a duplicate Content-Disposition header', () => {
    const two = bytes('--B\r\nContent-Disposition: form-data; name="a"\r\nContent-Disposition: form-data; name="b"\r\n\r\nx\r\n--B--')
    expect(status(() => parseMultipart(two, 'B'))).toBe(400)
  })

  it('keeps a traversal filename as data and cannot pollute prototypes', () => {
    const traversal = bytes('--B\r\nContent-Disposition: form-data; name="f"; filename="../../etc/passwd"\r\n\r\nx\r\n--B--')
    expect(parseMultipart(traversal, 'B').get('f')?.[0]).toMatchObject({ filename: '../../etc/passwd' })
    const proto = bytes('--B\r\nContent-Disposition: form-data; name="__proto__"\r\n\r\nx\r\n--B--')
    expect(parseMultipart(proto, 'B').get('__proto__')?.[0]).toBe('x')
    expect(({} as { x?: unknown }).x).toBeUndefined()
  })

  it('rejects oversized part headers', () => {
    const bigHeader = bytes('--B\r\nContent-Disposition: form-data; name="a"' + '; x=y'.repeat(300) + '\r\n\r\nx\r\n--B--')
    expect(status(() => parseMultipart(bigHeader, 'B'))).toBe(400)
  })
})

it('ReDoS: an email-style regex only ever sees bounded input', () => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  const evil = 'a@' + 'a.'.repeat(100) // the length check runs before the regex
  const start = performance.now()
  for (let i = 0; i < 1000; i++) re.test(evil.slice(0, 200) + '!')
  expect(performance.now() - start).toBeLessThan(200)
})

// Found while building the PoC: Bun 1.4.2's native router decodes params ("/users/4%2F2" -> "4/2",
// "/users/%2e%2e" -> "..") and routes "/users/.." to "/users/:id" while req.url reports "/".
it('decoded router params cannot carry separators, dot-segments or control bytes', () => {
  for (const v of ['4/2', '..', '.', '42\u0000', 'a\\b', 'x\ny', '', '\u007f']) expect(safeSegment(v), JSON.stringify(v)).toBe(false)
  for (const v of ['42', 'a b', 'ส', 'file.txt', '...', '42;x']) expect(safeSegment(v), v).toBe(true)
})
