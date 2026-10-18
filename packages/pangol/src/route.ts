import type { RegisteredUser } from './auth.js'
import type { Infer, Schema } from './schema.js'

export type Auth = 'public' | 'optional' | 'user' | { readonly permission: string }
type InputSchema = Schema<unknown> | undefined
type Field<K extends string, S extends InputSchema> = S extends Schema<unknown>
  ? { readonly [P in K]: Infer<S> } : {}
type AuthContext<A extends Auth> = A extends 'public' ? {}
  : { readonly user: A extends 'optional' ? RegisteredUser | null : RegisteredUser }

export type InputContext<A extends Auth, P extends InputSchema, Q extends InputSchema, B extends InputSchema> =
  (P extends Schema<unknown> ? Field<'params', P> : { readonly params: Readonly<Record<string, string>> })
  & Field<'query', Q> & Field<'body', B> & AuthContext<A>
  & { readonly ip: string; readonly headers: Omit<Headers, 'append' | 'delete' | 'set'> }

declare const result: unique symbol
export interface Created<T> { readonly [result]: 'created'; readonly value: T }
export interface NoContent { readonly [result]: 'noContent' }
export interface Failure { readonly [result]: 'failure'; readonly status: number; readonly message: string }
type ResponseValue<S extends Schema<unknown>> = Infer<S> extends undefined
  ? NoContent | Failure : Infer<S> | Created<Infer<S>> | Failure
type ResponseHelpers<S extends Schema<unknown>> = {
  readonly fail: (status: number, message: string) => Failure
} & (Infer<S> extends undefined ? { readonly noContent: () => NoContent }
  : { readonly created: (value: Infer<S>) => Created<Infer<S>> })

type Context<A extends Auth, P extends InputSchema, Q extends InputSchema, B extends InputSchema, R, S extends Schema<unknown>> =
  InputContext<A, P, Q, B> & ResponseHelpers<S>
  & ([R] extends [never] ? {} : { readonly resource: NonNullable<Awaited<R>> })

export interface RouteDefinition<A extends Auth, P extends InputSchema, Q extends InputSchema, B extends InputSchema, R, S extends Schema<unknown>> {
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

/** Declaration only: this does not dispatch requests or execute unvalidated handlers. */
export function route<
  const A extends Auth,
  S extends Schema<unknown>,
  R,
  P extends InputSchema = undefined,
  Q extends InputSchema = undefined,
  B extends InputSchema = undefined,
>(definition: RouteDefinition<A, P, Q, B, R, S> & {
  readonly load: (context: InputContext<A, P, Q, B>) => R
} & (A extends 'public' ? { readonly owner?: 'none' | 'query' } : {})): RouteDefinition<A, P, Q, B, R, S>
export function route<
  const A extends Auth,
  S extends Schema<unknown>,
  P extends InputSchema = undefined,
  Q extends InputSchema = undefined,
  B extends InputSchema = undefined,
>(definition: Omit<RouteDefinition<A, P, Q, B, never, S>, 'load' | 'owner'> & {
  readonly load?: never
  readonly owner?: 'none' | 'query'
}): RouteDefinition<A, P, Q, B, never, S>
export function route(definition: object): object {
  return Object.freeze({ ...definition })
}
