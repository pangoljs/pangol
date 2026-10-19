import type { RegisteredUser } from './auth.js'
import type { AnySchema, Infer, Schema } from './schema.js'

export type Auth = 'public' | 'optional' | 'user' | { readonly permission: string }
// params, query and body are always objects: fields are validated, unknown keys dropped.
// Private fields are allowed in input (e.g. a password); only responses refuse them.
type InputSchema = Schema<Readonly<Record<string, unknown>>, boolean> | undefined
type Field<K extends string, S extends InputSchema> = S extends AnySchema
  ? { readonly [P in K]: Infer<S> } : {}
type AuthContext<A extends Auth> = A extends 'public' ? {}
  : { readonly user: A extends 'optional' ? RegisteredUser | null : RegisteredUser }

export type InputContext<A extends Auth, P extends InputSchema, Q extends InputSchema, B extends InputSchema> =
  (P extends AnySchema ? Field<'params', P> : { readonly params: Readonly<Record<string, string>> })
  & Field<'query', Q> & Field<'body', B> & AuthContext<A>
  & { readonly ip: string; readonly headers: Omit<Headers, 'append' | 'delete' | 'set'> }

declare const result: unique symbol
export interface Created<T> { readonly [result]: 'created'; readonly value: T }
export interface NoContent { readonly [result]: 'noContent' }
/** Registered 4xx codes. A 2xx would skip response filtering; a 5xx should be a thrown error. */
export type FailStatus =
  | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415
  | 416 | 417 | 421 | 422 | 423 | 424 | 425 | 426 | 428 | 429 | 431 | 451
export interface Failure { readonly [result]: 'failure'; readonly status: FailStatus; readonly message: string }
type ResponseValue<S extends AnySchema> = Infer<S> extends undefined
  ? NoContent | Failure : Infer<S> | Created<Infer<S>> | Failure
type ResponseHelpers<S extends AnySchema> = {
  readonly fail: (status: FailStatus, message: string) => Failure
} & (Infer<S> extends undefined ? { readonly noContent: () => NoContent }
  : { readonly created: (value: Infer<S>) => Created<Infer<S>> })

type Context<A extends Auth, P extends InputSchema, Q extends InputSchema, B extends InputSchema, R, S extends AnySchema> =
  InputContext<A, P, Q, B> & ResponseHelpers<S>
  & ([R] extends [never] ? {} : { readonly resource: NonNullable<Awaited<R>> })

export interface RouteDefinition<A extends Auth, P extends InputSchema, Q extends InputSchema, B extends InputSchema, R, S extends AnySchema> {
  readonly auth: A
  readonly params?: P
  readonly query?: Q
  readonly body?: B
  readonly response: S
  readonly load?: (context: InputContext<A, P, Q, B>) => R
  readonly owner?: 'none' | 'query' | ((context: InputContext<A, P, Q, B>, record: NonNullable<Awaited<NoInfer<R>>>) => boolean)
  readonly handler: (context: Context<A, P, Q, B, NoInfer<R>, NoInfer<S>>) =>
    ResponseValue<NoInfer<S>> | Promise<ResponseValue<NoInfer<S>>>
  readonly rateLimit?: string
  readonly description?: string
}

// Declarations the generics accept but the framework must refuse; the string is the error shown.
type AuthRule<A> = A extends { readonly permission: '' } ? 'auth.permission must not be empty' : unknown
type ResponseRule<S extends AnySchema> = undefined extends Infer<S>
  ? [Infer<S>] extends [undefined] ? unknown : 'response must not be optional: use t.empty() with c.noContent()'
  : S['isPrivate'] extends false ? unknown : 'response must not include a .private() field: use Model.public() or .omit(...)'
type Rules<A extends Auth, S extends AnySchema> = { readonly auth: AuthRule<A>; readonly response: ResponseRule<S> }

/** Declaration only: this does not dispatch requests or execute unvalidated handlers. */
export function route<
  const A extends Auth,
  S extends AnySchema,
  R,
  P extends InputSchema = undefined,
  Q extends InputSchema = undefined,
  B extends InputSchema = undefined,
>(definition: RouteDefinition<A, P, Q, B, R, S> & {
  readonly load: (context: InputContext<A, P, Q, B>) => R
} & (A extends 'public' ? { readonly owner?: 'none' | 'query' } : {}) & Rules<A, S>): RouteDefinition<A, P, Q, B, R, S>
export function route<
  const A extends Auth,
  S extends AnySchema,
  P extends InputSchema = undefined,
  Q extends InputSchema = undefined,
  B extends InputSchema = undefined,
>(definition: Omit<RouteDefinition<A, P, Q, B, never, S>, 'load' | 'owner'> & {
  readonly load?: never
  readonly owner?: 'none' | 'query'
} & Rules<A, S>): RouteDefinition<A, P, Q, B, never, S>
export function route(definition: object): object {
  return Object.freeze({ ...definition })
}
