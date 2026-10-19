/**
 * pangol — v0.1 work starts here. See docs/SPEC.md for what goes in this package
 * (route, t, t.model, t.money, load/owner, compiler, adapters, check, manifest, diff).
 */
export const version = '0.1.0-alpha.0' // kept equal to package.json by test/smoke.test.ts
export { t, Schema, Model } from './schema.js'
export type { AnySchema, Infer, ObjectOutput, Shape } from './schema.js'
export { money } from './money.js'
export type { Rounding } from './money.js'
export { defineAuth } from './auth.js'
export type { AuthDefinition, AuthRequest, CredentialSource, Register, RegisteredUser, User } from './auth.js'
export { route } from './route.js'
export { createApp } from './runtime/app.js'
export type { App, AppOptions, RequestInfo, RouteKey } from './runtime/app.js'
export type { Auth, RouteDefinition, Created, NoContent, Failure, FailStatus } from './route.js'
