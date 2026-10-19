// CORS (SPEC section 8): off unless origins are listed, and then only those exact origins get
// headers. Never `*`. Every header set is built at startup; a request only looks one up.

export interface CorsOptions {
  /** Exact origins such as 'https://app.example.com' (scheme, host, port only; no wildcard). */
  readonly origins: readonly string[]
  /** Request headers a browser may send besides Authorization and Content-Type. */
  readonly headers?: readonly string[]
  /** Seconds a browser may cache a preflight answer. Default 600, at most 86,400. */
  readonly maxAge?: number
}

type Headers = Readonly<Record<string, string>>
export interface Cors {
  readonly origins: ReadonlySet<string>
  /** Headers for a response to `origin`, replacing `base`: Vary always, Allow-Origin when listed. */
  response(origin: string | null, empty: boolean): Headers
  /** Headers for a preflight from a listed origin, or null when the origin is not listed. */
  preflight(origin: string | null, methods: string): Headers | null
}

const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/ // RFC 9110 field-name
const KEYS = ['origins', 'headers', 'maxAge']

function isOrigin(value: unknown): value is string {
  if (typeof value !== 'string' || value.includes('*')) return false
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.origin === value
  } catch { return false }
}

/** Checks the options (problems are added to the list) and builds every header set. */
export function compileCors(options: unknown, credentials: boolean, base: { json: Headers; empty: Headers }, problems: { what: string; fix: string }[]): Cors | undefined {
  const problem = (what: string, fix: string) => { problems.push({ what, fix }) }
  if (typeof options !== 'object' || options === null) { problem('cors must be an object', "cors: { origins: ['https://app.example.com'] }"); return undefined }
  const before = problems.length
  for (const key of Object.keys(options)) {
    if (KEYS.includes(key)) continue
    problem(`cors.${key} is not an option`, key === 'credentials'
      ? 'credentials are allowed automatically when auth reads a cookie, and never otherwise'
      : `options are ${KEYS.join(', ')}`)
  }
  const { origins, headers = [], maxAge = 600 } = options as Partial<CorsOptions>
  if (!Array.isArray(origins) || origins.length === 0) {
    problem('cors.origins must list at least one origin', "cors: { origins: ['https://app.example.com'] }, or leave cors out to keep it off")
  } else {
    for (const o of origins) {
      if (!isOrigin(o)) problem(`cors.origins: ${JSON.stringify(o)} is not an exact origin`, "write scheme://host[:port] as a browser sends it, e.g. 'https://app.example.com' (lowercase, no path, no trailing slash, no default port, no *)")
    }
  }
  if (!Array.isArray(headers) || !headers.every((h) => typeof h === 'string' && TOKEN.test(h))) {
    problem('cors.headers must be header names', "cors: { headers: ['X-Request-Id'] }")
  }
  if (!Number.isSafeInteger(maxAge) || maxAge < 0 || maxAge > 86_400) problem('cors.maxAge must be whole seconds from 0 to 86400', 'cors: { maxAge: 600 }')
  if (problems.length > before) return undefined

  const allowHeaders = [...new Set(['authorization', 'content-type', ...headers.map((h) => h.toLowerCase())])].join(', ')
  const vary = { vary: 'origin' }
  const other = { json: { ...base.json, ...vary }, empty: { ...base.empty, ...vary } }
  const listed = new Map((origins as string[]).map((origin) => {
    const allow = { 'access-control-allow-origin': origin, ...(credentials && { 'access-control-allow-credentials': 'true' }), ...vary }
    const preflight = { ...base.empty, ...allow, 'access-control-allow-headers': allowHeaders, 'access-control-max-age': String(maxAge) }
    return [origin, { json: { ...base.json, ...allow }, empty: { ...base.empty, ...allow }, preflight }] as const
  }))
  return {
    origins: new Set(listed.keys()),
    response(origin, empty) {
      const set = (origin === null ? undefined : listed.get(origin)) ?? other
      return empty ? set.empty : set.json
    },
    preflight(origin, methods) {
      const set = origin === null ? undefined : listed.get(origin)
      return set === undefined ? null : { ...set.preflight, 'access-control-allow-methods': methods }
    },
  }
}
