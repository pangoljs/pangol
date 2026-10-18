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

  /** The value is copied and deep-frozen, so requests can never share mutable default state. */
  default(value: Exclude<T, undefined>): Schema<Exclude<T, undefined>> {
    return new Schema(this.kind, { ...this.options, optional: false, default: deepFreeze(structuredClone(value)) })
  }
}

function deepFreeze<V>(value: V): V {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const item of Object.values(value)) deepFreeze(item)
  }
  return value
}

type Bounds = { min?: number | undefined; max?: number | undefined }

// Runs once per declaration, never per request. `max: undefined` keeps the default limit.
function bounds(name: string, options: Bounds, valid: (n: number) => boolean, rule: string, defaultMax?: number) {
  const out: { min?: number; max?: number } = {}
  for (const key of ['min', 'max'] as const) {
    const n = options[key] ?? (key === 'max' ? defaultMax : undefined)
    if (n === undefined) continue
    if (!valid(n)) throw new TypeError(`t.${name}: ${key} must be ${rule}, got ${String(n)}`)
    out[key] = n
  }
  if (out.min !== undefined && out.max !== undefined && out.min > out.max) {
    throw new RangeError(`t.${name}: min (${out.min}) is greater than max (${out.max})`)
  }
  return out
}
const isLength = (n: number) => Number.isSafeInteger(n) && n >= 0
const LENGTH = 'a non-negative integer'

function statelessPattern(pattern: RegExp): RegExp {
  if (pattern.global || pattern.sticky) {
    throw new TypeError(`t.string: pattern ${String(pattern)} must not use the g or y flag (RegExp.test would keep state between requests)`)
  }
  return new RegExp(pattern.source, pattern.flags)
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

interface StringOptions extends Bounds { pattern?: RegExp | undefined }
type NumberOptions = Bounds
type ArrayOptions = Bounds

export const t = Object.freeze({
  string: (options: StringOptions = {}): Schema<string> => new Schema('string', {
    ...bounds('string', options, isLength, LENGTH, 10_000),
    ...(options.pattern !== undefined && { pattern: statelessPattern(options.pattern) }),
  }),
  id: (): Schema<string> => new Schema('id', { min: 1, max: 200 }),
  int: (options: NumberOptions = {}): Schema<number> =>
    new Schema('int', bounds('int', options, Number.isSafeInteger, 'a safe integer')),
  number: (options: NumberOptions = {}): Schema<number> =>
    new Schema('number', bounds('number', options, Number.isFinite, 'a finite number')),
  bool: (): Schema<boolean> => new Schema('bool'),
  enum: <const V extends readonly [string, ...string[]]>(values: V): Schema<V[number]> =>
    new Schema('enum', { values: Object.freeze([...values]) }),
  array: <S extends Schema<unknown>>(item: S, options: ArrayOptions = {}): Schema<Infer<S>[]> =>
    new Schema('array', { ...bounds('array', options, isLength, LENGTH, 1_000), item }),
  object: <const S extends Shape>(properties: S): Schema<ObjectOutput<S>> =>
    new Schema('object', { properties: Object.freeze({ ...properties }), additionalProperties: false }),
  empty: (): Schema<undefined> => new Schema('empty'),
})
