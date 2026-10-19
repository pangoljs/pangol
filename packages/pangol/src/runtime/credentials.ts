// Reading credentials and the cross-origin rule for cookie auth (SPEC section 12).
// Results: a string, `undefined` when there is no credential, `null` when it is malformed or
// ambiguous (-> 401: never guess which of two values is the real one).

// RFC 6750 b64token; the scheme name is case-insensitive (RFC 9110).
const BEARER = /^bearer ([A-Za-z0-9\-._~+/]+=*)$/i

export function bearerToken(header: string | null): string | null | undefined {
  if (header === null) return undefined
  return BEARER.exec(header)?.[1] ?? null
}

/** name -> value; a name sent twice maps to null. */
export function parseCookies(header: string | null): Map<string, string | null> {
  const cookies = new Map<string, string | null>()
  if (header === null) return cookies
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    const name = part.slice(0, eq).trim()
    if (name === '') continue
    cookies.set(name, cookies.has(name) ? null : part.slice(eq + 1).trim())
  }
  return cookies
}

export function cookieCredential(cookies: Map<string, string | null>, name: string): string | null | undefined {
  const value = cookies.get(name)
  return value === '' ? undefined : value
}

/**
 * May a request with a cookie credential change data? Same approach as Go's CrossOriginProtection:
 * browsers send Sec-Fetch-Site (or at least Origin) on cross-origin requests; other clients send
 * neither and cannot be a cross-site forgery.
 */
export function sameOriginOrAllowed(header: (name: string) => string | null, host: string, allowed: ReadonlySet<string>): boolean {
  const origin = header('origin')
  const site = header('sec-fetch-site')
  if (site !== null) return site === 'same-origin' || site === 'none' || (origin !== null && allowed.has(origin))
  if (origin === null || allowed.has(origin)) return true
  try { return new URL(origin).host === host } catch { return false } // "null" and junk origins fail
}
