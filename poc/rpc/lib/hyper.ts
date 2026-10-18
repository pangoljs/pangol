// Minimal server-side API of the PoC: route() only.
// Schemas are any Standard Schema (Zod, Valibot, ArkType ...). The handler gets a flat context.

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1
    readonly vendor: string
    readonly validate: (value: unknown) => unknown
    readonly types?: { readonly input: Input; readonly output: Output } | undefined
  }
}
type Types<S extends StandardSchemaV1> = NonNullable<S['~standard']['types']>
type Out<S> = S extends StandardSchemaV1 ? Types<S>['output'] : undefined
type In<S> = S extends StandardSchemaV1 ? Types<S>['input'] : unknown

export type Auth = 'public' | 'user' | { permission: string }

export interface Ctx<P, Q, B> {
  params: Out<P>
  query: Out<Q>
  body: Out<B>
  user: { id: string; permissions: readonly string[] }
}

type S = StandardSchemaV1 | undefined

export interface RouteDef<P extends S, Q extends S, B extends S, R extends S> {
  auth: Auth
  params?: P
  query?: Q
  body?: B
  response?: R
  handler: (c: Ctx<P, Q, B>) => In<R> | Promise<In<R>>
}

export function route<P extends S = undefined, Q extends S = undefined, B extends S = undefined, R extends S = undefined>(
  def: RouteDef<P, Q, B, R>,
): RouteDef<P, Q, B, R> {
  return def
}
