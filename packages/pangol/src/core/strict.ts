// Strict request parsers, ported from poc/strict. Design rules:
//  1. Fail closed: anything ambiguous is rejected, never "normalized" into something else.
//  2. One canonical parse feeds every later decision (routing, parser choice, validation).
//  3. Linear time and hard limits on every input dimension.
// Web standards only (URL, TextDecoder, Uint8Array), so every adapter can share this file.

export type RejectStatus = 400 | 413

export class Reject extends Error {
  constructor(readonly status: RejectStatus, readonly code: string) {
    super(code)
  }
}

// ---------------------------------------------------------------- paths
// A path is accepted only if it is already in canonical form, so a proxy in front of the app
// and the app itself cannot disagree about which path was requested (Hono CVE-2025-58362 class).
const table = (s: string) => { const t = new Uint8Array(128); for (const ch of s) t[ch.charCodeAt(0)] = 1; return t }
const ALNUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
const UNRESERVED = table(ALNUM + '-._~')
const RAW_PCHAR = table(ALNUM + "-._~!$&'()*+,;=:@/") // RFC 3986 pchar + '/', without '%'
const hexVal = (c: number) => (c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : -1) // uppercase only

export const MAX_PATH = 2048

// Validates s[from, to) in place (no allocation). Returns true when it is a canonical path.
function checkRange(s: string, from: number, to: number): boolean {
  const n = to - from
  if (n <= 0 || n > MAX_PATH || s.charCodeAt(from) !== 47) return false
  if (n > 1 && s.charCodeAt(to - 1) === 47) return false // no trailing slash: one spelling per route
  let segStart = from + 1
  let highBytes = false
  for (let i = from + 1; i <= to; i++) {
    const c = i < to ? s.charCodeAt(i) : 47
    if (c === 47) {
      const len = i - segStart
      if (len === 0 && n > 1) return false // empty segment: "//"
      if (len === 1 && s.charCodeAt(segStart) === 46) return false // "."
      if (len === 2 && s.charCodeAt(segStart) === 46 && s.charCodeAt(segStart + 1) === 46) return false // ".."
      segStart = i + 1
    } else if (c === 37) {
      if (i + 2 >= to) return false
      const h = hexVal(s.charCodeAt(i + 1)), l = hexVal(s.charCodeAt(i + 2))
      if (h < 0 || l < 0) return false // bad or lowercase hex
      const b = h * 16 + l
      // encoded separators, dots, percent, controls and unreserved chars all have a second spelling
      if (b < 0x20 || b === 0x7f || b === 0x2f || b === 0x5c || b === 0x2e || b === 0x25 || (b < 128 && UNRESERVED[b])) return false
      if (b >= 128) highBytes = true
      i += 2
    } else if (c >= 128 || !RAW_PCHAR[c]) {
      return false
    }
  }
  if (highBytes) { try { decodeURIComponent(s.slice(from, to)) } catch { return false } } // must be valid UTF-8
  return true
}

export function checkPath(p: string): string | null {
  return typeof p === 'string' && checkRange(p, 0, p.length) ? p : null
}

const AUTHORITY = /^(?:\[[0-9A-Fa-f:.]{2,45}\]|[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?)(?::[0-9]{1,5})?$/
// Host rules (IPv4 forms like "a.5", IPv6 syntax) are delegated to the WHATWG parser, once per
// distinct authority. The cache is bounded, so an attacker cycling hosts only costs one parse each.
const authorityCache = new Map<string, boolean>()
function validAuthority(a: string): boolean {
  const hit = authorityCache.get(a)
  if (hit !== undefined) return hit
  let ok = AUTHORITY.test(a)
  if (ok) { try { ok = new URL('http://' + a + '/').host === a.toLowerCase().replace(/:80$/, '') } catch { ok = false } }
  if (authorityCache.size >= 1024) authorityCache.clear()
  authorityCache.set(a, ok)
  return ok
}
// Runtimes like Bun hand every request an absolute URL with the same "http://host:port" prefix.
// Remembering the last validated prefix lets the hot path compare bytes instead of slicing and hashing.
let lastPrefix = ''

// Offset where the path starts, or -1 if the request-target is not acceptable.
// Returns url.length for "http://host" with no path (meaning "/").
function pathStart(url: string): number {
  if (url.charCodeAt(0) === 47) return 0
  if (lastPrefix !== '' && url.startsWith(lastPrefix)) {
    if (url.charCodeAt(lastPrefix.length) === 47) return lastPrefix.length
  }
  // scheme must be http or https (any case): other schemes have different path rules
  const s = url.indexOf('://')
  if (s !== 4 && s !== 5) return -1
  const scheme = s === 4 ? 'http' : 'https'
  for (let k = 0; k < s; k++) if ((url.charCodeAt(k) | 32) !== scheme.charCodeAt(k)) return -1
  const auth = s + 3
  let authEnd = auth
  while (authEnd < url.length) { const c = url.charCodeAt(authEnd); if (c === 47 || c === 63 || c === 35) break; authEnd++ }
  // authority must be a plain host[:port]: no userinfo, no "\", no junk ("http:///x", "http://a:1*", "http://a@b")
  if (!validAuthority(url.slice(auth, authEnd))) return -1
  if (authEnd === url.length) return authEnd
  if (url.charCodeAt(authEnd) !== 47) return -1
  lastPrefix = url.slice(0, authEnd)
  return authEnd
}

function pathEnd(url: string, start: number): number {
  if (url.indexOf('#', start) !== -1) return -1 // a request-target never carries a fragment (RFC 9112)
  const q = url.indexOf('?', start)
  return q === -1 ? url.length : q
}

/** Extract the path from origin-form ("/a?b") or absolute-form ("http://h/a?b") request targets. */
export function pathFromUrl(url: string): string | null {
  if (typeof url !== 'string') return null
  const start = pathStart(url)
  if (start === -1) return null
  if (start === url.length) return '/'
  const end = pathEnd(url, start)
  if (end === -1 || !checkRange(url, start, end)) return null
  return url.slice(start, end)
}

/** Same rules as pathFromUrl, but allocation-free: for adapters whose router already has the path. */
export function validTarget(url: string): boolean {
  const start = pathStart(url)
  if (start === -1) return false
  if (start === url.length) return true
  const end = pathEnd(url, start)
  return end !== -1 && checkRange(url, start, end)
}

// ---------------------------------------------------------------- media types (RFC 9110)
// Fastify CVE-2025-32442 class: the content type that picks the parser and the one that picks the
// schema must be the same value. Here there is only one: the parsed, lowercased media type.
const TCHAR = table(ALNUM + "!#$%&'*+-.^_`|~")
const isOws = (c: number) => c === 32 || c === 9

function readToken(s: string, i: number, n: number): number {
  let j = i
  while (j < n) { const c = s.charCodeAt(j); if (c >= 128 || !TCHAR[c]) break; j++ }
  return j
}

export type MediaParams = Record<string, string>

// parameters after the first token(s): *( OWS ";" OWS name "=" value ) — strict: no empty params, no duplicates
function readParams(s: string, i: number, n: number): MediaParams | null {
  const params: MediaParams = Object.create(null)
  while (true) {
    while (i < n && isOws(s.charCodeAt(i))) i++
    if (i === n) return params
    if (s.charCodeAt(i) !== 59) return null // ";"
    i++
    while (i < n && isOws(s.charCodeAt(i))) i++
    const ne = readToken(s, i, n)
    if (ne === i || s.charCodeAt(ne) !== 61) return null
    const name = s.slice(i, ne).toLowerCase()
    i = ne + 1
    let value: string
    if (s.charCodeAt(i) === 34) { // quoted-string
      let j = i + 1, out = ''
      while (true) {
        if (j >= n) return null
        const c = s.charCodeAt(j)
        if (c === 34) break
        if (c === 92) { if (j + 1 >= n) return null; out += s[j + 1]; j += 2; continue }
        if ((c < 32 && c !== 9) || c === 127) return null
        out += s[j]; j++
      }
      value = out; i = j + 1
    } else {
      const ve = readToken(s, i, n)
      if (ve === i) return null
      value = s.slice(i, ve); i = ve
    }
    if (name in params) return null
    params[name] = value
  }
}

export function mediaType(v: string | null | undefined): { type: string; params: MediaParams } | null {
  if (typeof v !== 'string' || v.length === 0 || v.length > 512) return null
  let i = 0, n = v.length
  while (i < n && isOws(v.charCodeAt(i))) i++
  while (n > i && isOws(v.charCodeAt(n - 1))) n--
  const t1 = readToken(v, i, n)
  if (t1 === i || v.charCodeAt(t1) !== 47) return null
  const t2 = readToken(v, t1 + 1, n)
  if (t2 === t1 + 1) return null
  const params = readParams(v, t2, n)
  if (params === null) return null
  return { type: v.slice(i, t2).toLowerCase(), params }
}

// application/json with at most a utf-8 charset; anything else is "not JSON" (-> 415)
// The spellings clients actually send are already canonical, so they skip the full parser.
const JSON_FAST = new Set(['application/json', 'application/json; charset=utf-8', 'application/json;charset=utf-8', 'application/json; charset=UTF-8', 'application/json;charset=UTF-8'])
export function isJson(ct: string | null | undefined): boolean {
  if (typeof ct === 'string' && JSON_FAST.has(ct)) return true
  const m = mediaType(ct)
  if (m === null || m.type !== 'application/json') return false
  for (const k in m.params) if (k !== 'charset' || m.params[k]?.toLowerCase() !== 'utf-8') return false
  return true
}

// ---------------------------------------------------------------- bytes -> text
// fatal: invalid UTF-8 is a 400, never U+FFFD. ignoreBOM: a byte order mark stays in the text,
// so the JSON parser rejects it instead of it being dropped silently.
const UTF8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true })
export function decodeUtf8(bytes: Uint8Array): string {
  try { return UTF8.decode(bytes) } catch { throw new Reject(400, 'invalid_utf8') }
}

// ---------------------------------------------------------------- JSON
// A linear pre-scan enforces limits JSON.parse cannot: nesting depth, keys per object,
// items per array, duplicate keys (parser-differential risk) and prototype keys.
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype'])
export interface JsonLimits { readonly maxDepth: number; readonly maxKeys: number; readonly maxItems: number }
export const JSON_LIMITS: JsonLimits = Object.freeze({ maxDepth: 32, maxKeys: 256, maxItems: 10_000 })

export function parseJson(text: string, limits: JsonLimits = JSON_LIMITS): unknown {
  const { maxDepth, maxKeys, maxItems } = limits
  const n = text.length
  const kinds: number[] = [] // 1 object, 2 array
  const counts: number[] = []
  const keys: (string[] | Set<string> | undefined)[] = []
  let expectKey = false
  let nextBs = text.indexOf('\\') // position of the next backslash, advanced lazily (keeps the scan O(n))
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i)
    if (c === 34) {
      // fast path: no backslash before the next quote -> that quote closes the string (native indexOf)
      if (nextBs !== -1 && nextBs <= i) nextBs = text.indexOf('\\', i + 1)
      let j = text.indexOf('"', i + 1)
      let esc = false
      if (j !== -1 && nextBs !== -1 && nextBs < j) {
        // slow path, only for strings that contain escapes: walk char by char from the first backslash
        esc = true
        j = nextBs
        while (j < n) { const d = text.charCodeAt(j); if (d === 92) { j += 2; continue } if (d === 34) break; j++ }
        if (j >= n) j = -1
        nextBs = j === -1 ? -1 : text.indexOf('\\', j + 1)
      }
      if (j === -1) throw new Reject(400, 'invalid_json')
      if (expectKey) {
        let key: unknown
        if (esc) { try { key = JSON.parse(text.slice(i, j + 1)) } catch { throw new Reject(400, 'invalid_json') } }
        else key = text.slice(i + 1, j)
        if (typeof key !== 'string') throw new Reject(400, 'invalid_json')
        if (FORBIDDEN.has(key)) throw new Reject(400, 'forbidden_key')
        const top = kinds.length - 1
        // small objects: a plain array beats a Set; switch to a Set past 16 keys
        const seen = keys[top]
        if (seen === undefined) keys[top] = [key]
        else if (Array.isArray(seen)) {
          if (seen.includes(key)) throw new Reject(400, 'duplicate_key')
          seen.push(key)
          if (seen.length > maxKeys) throw new Reject(413, 'too_many_keys')
          if (seen.length > 16) keys[top] = new Set(seen)
        } else {
          if (seen.has(key)) throw new Reject(400, 'duplicate_key')
          seen.add(key)
          if (seen.size > maxKeys) throw new Reject(413, 'too_many_keys')
        }
        expectKey = false
      }
      i = j
    } else if (c === 123 || c === 91) {
      if (kinds.length >= maxDepth) throw new Reject(400, 'too_deep')
      kinds.push(c === 123 ? 1 : 2); counts.push(0); keys.push(undefined)
      expectKey = c === 123
    } else if (c === 125 || c === 93) {
      kinds.pop(); counts.pop(); keys.pop(); expectKey = false
    } else if (c === 44) {
      const top = kinds.length - 1
      if (kinds[top] === 1) expectKey = true
      else if (kinds[top] === 2 && (counts[top] = (counts[top] ?? 0) + 1) >= maxItems) throw new Reject(413, 'too_many_items')
    }
  }
  try { return JSON.parse(text) } catch { throw new Reject(400, 'invalid_json') }
}

// ---------------------------------------------------------------- multipart/form-data
// Elysia CVE-2026-56669 class: field handling must be O(n). One pass, one Map, hard limits.
const BCHAR = /^[0-9A-Za-z'()+_,\-./:=? ]{0,69}[0-9A-Za-z'()+_,\-./:=?]$/
export interface MultipartLimits {
  readonly maxParts: number; readonly maxHeaderBytes: number; readonly maxFieldBytes: number; readonly maxFileBytes: number
}
export const MULTIPART_LIMITS: MultipartLimits = Object.freeze({ maxParts: 100, maxHeaderBytes: 1024, maxFieldBytes: 64 * 1024, maxFileBytes: 10 * 1024 * 1024 })

/** A file part. The client's filename is data only; it is never used as a path. */
export interface FilePart { readonly filename: string; readonly type: string; readonly data: Uint8Array }

export function boundaryOf(ct: string | null | undefined): string | null {
  const m = mediaType(ct)
  if (m === null || m.type !== 'multipart/form-data') return null
  const b = m.params['boundary']
  return b !== undefined && BCHAR.test(b) ? b : null
}

function disposition(h: string): MediaParams | null {
  // "form-data; name="x"; filename="y""
  const te = readToken(h, 0, h.length)
  if (h.slice(0, te).toLowerCase() !== 'form-data') return null
  const p = readParams(h, te, h.length)
  const name = p?.['name']
  if (p === null || name === undefined || name.length === 0 || name.length > 200) return null
  return p
}

const ENCODER = new TextEncoder()
const CRLF2 = ENCODER.encode('\r\n\r\n')

// First index of `needle` in hay[from, end), or -1. Linear in practice: the boundary is at most
// 74 bytes, and the native indexOf skips straight to each candidate first byte.
function indexOfBytes(hay: Uint8Array, needle: Uint8Array, from: number, end = hay.length): number {
  const first = needle[0]
  const last = end - needle.length
  for (let i = hay.indexOf(first ?? 0, from); i !== -1 && i <= last; i = hay.indexOf(first ?? 0, i + 1)) {
    let k = 1
    while (k < needle.length && hay[i + k] === needle[k]) k++
    if (k === needle.length) return i
  }
  return -1
}

const trimOws = (s: string) => {
  let i = 0, n = s.length
  while (i < n && isOws(s.charCodeAt(i))) i++
  while (n > i && isOws(s.charCodeAt(n - 1))) n--
  return s.slice(i, n)
}

export function parseMultipart(body: Uint8Array, boundary: string, limits: MultipartLimits = MULTIPART_LIMITS): Map<string, (string | FilePart)[]> {
  const delim = ENCODER.encode('--' + boundary)
  const sep = ENCODER.encode('\r\n--' + boundary)
  if (indexOfBytes(body, delim, 0, delim.length) !== 0) throw new Reject(400, 'bad_multipart')
  const fields = new Map<string, (string | FilePart)[]>()
  let pos = delim.length
  let parts = 0
  while (true) {
    if (body[pos] === 45 && body[pos + 1] === 45) return fields // closing "--"
    if (body[pos] !== 13 || body[pos + 1] !== 10) throw new Reject(400, 'bad_multipart')
    pos += 2
    if (++parts > limits.maxParts) throw new Reject(413, 'too_many_parts')
    // search only within the header limit, so a part without "\r\n\r\n" cannot make us scan the body
    const hEnd = indexOfBytes(body, CRLF2, pos, Math.min(body.length, pos + limits.maxHeaderBytes + CRLF2.length))
    if (hEnd === -1 || hEnd - pos > limits.maxHeaderBytes) throw new Reject(400, 'bad_part_headers')
    let disp: MediaParams | null = null, sawDisposition = false
    let type: string | null = null, sawType = false
    // browsers send filenames as raw UTF-8, so headers are decoded as UTF-8 (strictly)
    for (const line of decodeUtf8(body.subarray(pos, hEnd)).split('\r\n')) {
      const colon = line.indexOf(':')
      if (colon <= 0) throw new Reject(400, 'bad_part_headers')
      const name = line.slice(0, colon).toLowerCase()
      const value = trimOws(line.slice(colon + 1))
      if (name === 'content-disposition') {
        if (sawDisposition) throw new Reject(400, 'bad_part_headers')
        sawDisposition = true
        disp = disposition(value)
      } else if (name === 'content-type') {
        if (sawType) throw new Reject(400, 'bad_part_headers')
        sawType = true
        type = mediaType(value)?.type ?? null
      }
    }
    if (disp === null) throw new Reject(400, 'bad_part_headers')
    const start = hEnd + CRLF2.length
    const next = indexOfBytes(body, sep, start)
    if (next === -1) throw new Reject(400, 'bad_multipart')
    const filename = disp['filename']
    if (next - start > (filename !== undefined ? limits.maxFileBytes : limits.maxFieldBytes)) throw new Reject(413, 'part_too_large')
    const value: string | FilePart = filename !== undefined
      ? { filename, type: type ?? 'application/octet-stream', data: body.subarray(start, next) }
      : decodeUtf8(body.subarray(start, next))
    const name = disp['name'] as string // checked by disposition()
    const list = fields.get(name)
    if (list === undefined) fields.set(name, [value])
    else list.push(value)
    pos = next + sep.length
  }
}

// ---------------------------------------------------------------- params
// For runtimes whose router hands over already-decoded params (Bun.serve routes): a param value
// must not smuggle separators, dot-segments or control bytes into the handler.
export function safeSegment(v: unknown): v is string {
  if (typeof v !== 'string' || v.length === 0 || v.length > MAX_PATH || v === '.' || v === '..') return false
  for (let i = 0; i < v.length; i++) {
    const c = v.charCodeAt(i)
    if (c < 0x20 || c === 0x7f || c === 47 || c === 92) return false
  }
  return true
}
