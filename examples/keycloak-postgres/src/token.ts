import { createRemoteJWKSet, jwtVerify } from 'jose'

export function tokenVerifier(issuer: string, audience: string, cooldownDuration = 30_000) {
  const url = new URL(issuer)
  if (url.username || url.password || url.search || url.hash || issuer.endsWith('/')) throw new Error('Invalid issuer URL')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error('Issuer must use HTTPS (HTTP is allowed only for the local demo)')
  }
  if (!audience) throw new Error('An API audience is required')
  // Never take a JWKS address from the untrusted token. Cache keys, allow refresh after rotation.
  const keys = createRemoteJWKSet(new URL(`${issuer}/protocol/openid-connect/certs`), { timeoutDuration: 5000, cooldownDuration })
  return async (token: string) => {
    try {
      const { payload } = await jwtVerify(token, keys, {
        issuer, audience, algorithms: ['RS256'], requiredClaims: ['sub', 'exp', 'iat'],
      })
      // Keycloak access tokens use Bearer; ID tokens must not authenticate an API request.
      if (payload.typ !== 'Bearer' || typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 200) return null
      if (typeof payload.iat !== 'number' || payload.iat > Math.floor(Date.now() / 1000) + 5) return null
      const access = payload.resource_access
      const client = typeof access === 'object' && access !== null ? (access as Record<string, unknown>)[audience] : undefined
      const roles = typeof client === 'object' && client !== null ? (client as { roles?: unknown }).roles : undefined
      const permissions = Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string' && r === 'posts:write') : []
      return { issuer, subject: payload.sub, permissions }
    } catch {
      // Invalid/unverifiable tokens, including unavailable JWKS, fail closed. Never log the token.
      return null
    }
  }
}
