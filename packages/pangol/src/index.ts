/**
 * pangol — v0.1 work starts here. See docs/SPEC.md for what goes in this package
 * (route, t, t.model, t.money, load/owner, compiler, adapters, check, manifest, diff).
 */
export const version = '0.0.0'
export { t, Schema } from './schema.js'
export type { Infer, ObjectOutput } from './schema.js'
export { defineAuth } from './auth.js'
export type { AuthDefinition, Register, RegisteredUser, User } from './auth.js'
export { route } from './route.js'
export type { Auth, RouteDefinition, Created, NoContent, Failure, FailStatus } from './route.js'
