/** Declarative schema metadata. Validation/serialization belongs to the compiler. */
export class Schema<T> {
  declare readonly output: T

  constructor(
    readonly kind: string,
    readonly options: Readonly<Record<string, unknown>> = {},
  ) {
    this.options = Object.freeze({ ...options })
    Object.freeze(this)
  }

  optional(): Schema<T | undefined> {
    return new Schema(this.kind, { ...this.options, optional: true })
  }

  default(value: Exclude<T, undefined>): Schema<Exclude<T, undefined>> {
    return new Schema(this.kind, { ...this.options, optional: false, default: value })
  }
}

export type Infer<S extends Schema<unknown>> = S['output']
type Shape = Readonly<Record<string, Schema<unknown>>>
type OptionalKeys<S extends Shape> = {
  [K in keyof S]: undefined extends Infer<S[K]> ? K : never
}[keyof S]
export type ObjectOutput<S extends Shape> = {
  [K in Exclude<keyof S, OptionalKeys<S>>]: Infer<S[K]>
} & {
  [K in OptionalKeys<S>]?: Infer<S[K]>
}

interface StringOptions { min?: number; max?: number; pattern?: RegExp }
interface NumberOptions { min?: number; max?: number }
interface ArrayOptions { min?: number; max?: number }

export const t = Object.freeze({
  string: (options: StringOptions = {}): Schema<string> =>
    new Schema('string', { max: 10_000, ...options }),
  id: (): Schema<string> => new Schema('id', { min: 1, max: 200 }),
  int: (options: NumberOptions = {}): Schema<number> => new Schema('int', { ...options }),
  number: (options: NumberOptions = {}): Schema<number> => new Schema('number', { ...options }),
  bool: (): Schema<boolean> => new Schema('bool'),
  enum: <const V extends readonly [string, ...string[]]>(values: V): Schema<V[number]> =>
    new Schema('enum', { values: Object.freeze([...values]) }),
  array: <S extends Schema<unknown>>(item: S, options: ArrayOptions = {}): Schema<Infer<S>[]> =>
    new Schema('array', { max: 1_000, ...options, item }),
  object: <const S extends Shape>(properties: S): Schema<ObjectOutput<S>> =>
    new Schema('object', { properties: Object.freeze({ ...properties }), additionalProperties: false }),
  empty: (): Schema<undefined> => new Schema('empty'),
})
