// Regression tests for gaps found when auditing poc/strict before porting it.
import { describe, expect, it } from 'vitest'
import { Reject, decodeUtf8, parseJson, parseMultipart } from '../../src/core/strict.js'

const status = (fn: () => unknown): number => {
  try { fn(); return 200 } catch (e) { if (e instanceof Reject) return e.status; throw e }
}
const bytes = (s: string) => new TextEncoder().encode(s)
const concat = (...parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

describe('JSON key limit applies to small objects too', () => {
  // The PoC only counted keys after switching to a Set (more than 16 keys), so a configured
  // jsonKeys of 16 or less was never enforced.
  const limits = { maxDepth: 32, maxKeys: 2, maxItems: 10 }
  it('rejects an object with more keys than a small limit', () => {
    expect(status(() => parseJson('{"a":1,"b":1,"c":1}', limits))).toBe(413)
  })
  it('accepts an object at the limit', () => {
    expect(parseJson('{"a":1,"b":1}', limits)).toEqual({ a: 1, b: 1 })
  })
})

describe('UTF-8 is decoded strictly', () => {
  it('rejects invalid UTF-8 instead of replacing it with U+FFFD', () => {
    expect(status(() => decodeUtf8(new Uint8Array([0x7b, 0xff, 0x7d])))).toBe(400)
    expect(status(() => decodeUtf8(new Uint8Array([0xe0, 0xb8])))).toBe(400) // truncated sequence
  })
  it('keeps a byte order mark, so the JSON parser rejects it rather than silently dropping it', () => {
    const text = decodeUtf8(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d]))
    expect(text.charCodeAt(0)).toBe(0xfeff)
    expect(status(() => parseJson(text))).toBe(400)
  })
  it('decodes valid UTF-8 unchanged', () => {
    expect(decodeUtf8(bytes('{"name":"สวัสดี"}'))).toBe('{"name":"สวัสดี"}')
  })
})

describe('multipart part headers', () => {
  it('rejects a second Content-Type even when the first one does not parse', () => {
    // The PoC tracked duplicates through the parsed value, which is null for an invalid type.
    const body = bytes('--B\r\nContent-Disposition: form-data; name="a"\r\nContent-Type: ???\r\nContent-Type: text/plain\r\n\r\nx\r\n--B--')
    expect(status(() => parseMultipart(body, 'B'))).toBe(400)
  })
  it('accepts a single Content-Type', () => {
    const body = bytes('--B\r\nContent-Disposition: form-data; name="f"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nx\r\n--B--')
    expect(parseMultipart(body, 'B').get('f')?.[0]).toMatchObject({ filename: 'a.txt', type: 'text/plain' })
  })
  it('reads UTF-8 filenames as browsers send them', () => {
    const body = bytes('--B\r\nContent-Disposition: form-data; name="f"; filename="รูป.png"\r\n\r\nx\r\n--B--')
    expect(parseMultipart(body, 'B').get('f')?.[0]).toMatchObject({ filename: 'รูป.png' })
  })
  it('rejects invalid UTF-8 in a text field', () => {
    const body = concat(bytes('--B\r\nContent-Disposition: form-data; name="a"\r\n\r\n'), new Uint8Array([0xff]), bytes('\r\n--B--'))
    expect(status(() => parseMultipart(body, 'B'))).toBe(400)
  })
  it('keeps file bytes as they are, without decoding', () => {
    const body = concat(bytes('--B\r\nContent-Disposition: form-data; name="f"; filename="x.bin"\r\n\r\n'), new Uint8Array([0xff, 0x00]), bytes('\r\n--B--'))
    const file = parseMultipart(body, 'B').get('f')?.[0]
    expect(typeof file === 'object' && [...file.data]).toEqual([0xff, 0x00])
  })
})
