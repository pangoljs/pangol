export interface User {
  id: string
  permissions: readonly string[]
}

/** Augment with `auth: typeof auth` to infer the application's resolved user. */
export interface Register {}

export interface AuthDefinition<U extends User> {
  readonly resolve: (request: Request) => U | null | Promise<U | null>
}

export type RegisteredUser = Register extends { auth: AuthDefinition<infer U> } ? U : User

export function defineAuth<U extends User>(definition: AuthDefinition<U>): AuthDefinition<U> {
  return Object.freeze({ ...definition })
}
