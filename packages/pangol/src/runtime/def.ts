// Schema -> SchemaDef: the typed form the validator and serializer compile from. Reading the
// loose `options` record happens once here, so the compilers never cast.
import { Schema } from '../schema.js'

interface Modifiers { readonly optional: boolean; readonly hasDefault: boolean; readonly default?: unknown }
interface Bounded { readonly min?: number; readonly max?: number }

export type SchemaDef = Modifiers & (
  | { readonly kind: 'string'; readonly pattern?: RegExp } & Bounded
  | { readonly kind: 'id' | 'uuid' }
  | { readonly kind: 'email'; readonly max: number }
  | { readonly kind: 'money'; readonly scale: number; readonly min?: bigint; readonly max?: bigint }
  | { readonly kind: 'int' | 'number' } & Bounded
  | { readonly kind: 'bool' }
  | { readonly kind: 'empty' }
  | { readonly kind: 'enum'; readonly values: readonly string[] }
  | { readonly kind: 'array'; readonly item: SchemaDef } & Bounded
  | { readonly kind: 'object'; readonly fields: readonly (readonly [name: string, def: SchemaDef])[] }
)

const num = (v: unknown) => (typeof v === 'number' ? v : undefined)
const big = (v: unknown) => (typeof v === 'bigint' ? v : undefined)
const bounds = (o: Readonly<Record<string, unknown>>): Bounded => {
  const min = num(o['min']), max = num(o['max'])
  return { ...(min !== undefined && { min }), ...(max !== undefined && { max }) }
}

export function toDef(schema: unknown): SchemaDef {
  if (!(schema instanceof Schema)) throw new TypeError('expected a schema built with t (e.g. t.object({...}))')
  const o = schema.options
  const hasDefault = Object.hasOwn(o, 'default') && o['optional'] !== true
  const modifiers: Modifiers = { optional: o['optional'] === true, hasDefault, ...(hasDefault && { default: o['default'] }) }
  switch (schema.kind) {
    case 'string': {
      const pattern = o['pattern']
      return { ...modifiers, kind: 'string', ...bounds(o), ...(pattern instanceof RegExp && { pattern }) }
    }
    case 'id': case 'uuid': case 'bool': case 'empty':
      return { ...modifiers, kind: schema.kind }
    case 'int': case 'number':
      return { ...modifiers, kind: schema.kind, ...bounds(o) }
    case 'email': {
      const max = num(o['max'])
      if (max === undefined) throw new TypeError('t.email needs a max length')
      return { ...modifiers, kind: 'email', max }
    }
    case 'money': {
      const scale = num(o['scale']), min = big(o['min']), max = big(o['max'])
      if (scale === undefined) throw new TypeError('t.money needs a scale')
      return { ...modifiers, kind: 'money', scale, ...(min !== undefined && { min }), ...(max !== undefined && { max }) }
    }
    case 'enum': {
      const values = o['values']
      if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) throw new TypeError('t.enum needs string values')
      return { ...modifiers, kind: 'enum', values }
    }
    case 'array':
      return { ...modifiers, kind: 'array', item: toDef(o['item']), ...bounds(o) }
    case 'object': {
      const properties = o['properties']
      if (typeof properties !== 'object' || properties === null) throw new TypeError('t.object needs an object of schemas')
      const fields = Object.entries(properties).map(([name, s]) => {
        // `out[name] = value` on a plain object would set its prototype instead of a field
        if (name === '__proto__') throw new TypeError('t.object: a field cannot be named "__proto__"')
        return [name, toDef(s)] as const
      })
      return { ...modifiers, kind: 'object', fields }
    }
    default:
      throw new TypeError(`unknown schema kind "${schema.kind}"`)
  }
}
