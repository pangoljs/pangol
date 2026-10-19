export interface User {
  id: string
  permissions: readonly string[]
}

/** Augment with `auth: typeof auth` to infer the application's resolved user. */
export interface Register {}

/**
 * Where the credential comes from. The framework reads it, so it knows when a request carries
 * credentials (for `auth: 'optional'`) and when cookie auth needs cross-site request protection.
 */
export type CredentialSource = 'bearer' | { readonly cookie: string }

/**
 * What `resolve` sees: a read-only view the adapter builds without allocating a `Request`
 * (the Node adapter never creates one). `credential` is the bearer token or the cookie value.
 */
export interface AuthRequest {
  readonly method: string
  /** The request-target as received: path and query, already checked by the strict parser. */
  readonly url: string
  readonly headers: { get(name: string): string | null }
  readonly cookies: { get(name: string): string | undefined }
  readonly credential: string
}

export interface AuthDefinition<U extends User> {
  readonly from: CredentialSource
  readonly resolve: (request: AuthRequest) => U | null | Promise<U | null>
}

export type RegisteredUser = Register extends { auth: AuthDefinition<infer U> } ? U : User

// RFC 6265 cookie-name is an RFC 9110 token.
const COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

export function defineAuth<U extends User>(definition: AuthDefinition<U>): AuthDefinition<U> {
  const { from, resolve } = definition
  if (typeof resolve !== 'function') throw new TypeError('defineAuth: resolve must be a function (request) => user | null')
  if (from !== 'bearer') {
    const cookie: unknown = typeof from === 'object' && from !== null ? from.cookie : undefined
    if (typeof cookie !== 'string' || !COOKIE_NAME.test(cookie)) {
      throw new TypeError(`defineAuth: from must be 'bearer' or { cookie: '<name>' } with a valid cookie name, got ${JSON.stringify(from)}`)
    }
  }
  return Object.freeze({ ...definition, from: from === 'bearer' ? from : Object.freeze({ cookie: from.cookie }) })
}
