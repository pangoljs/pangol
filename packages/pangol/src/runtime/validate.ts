// Input validators: params, query and body. Each schema compiles once into closures that build a
// NEW value holding declared fields only, so undeclared input (mass assignment) never reaches a handler.
import { safeSegment } from '../core/strict.js'
import { toDef, type SchemaDef } from './def.js'
import { toDecimal, toMinor } from '../money.js'

/** Expected control flow for bad input (-> 400), so it skips the cost of an Error stack. */
export class ValidationError {
  constructor(public field: string, readonly message: string) {}
}

export type Source = 'params' | 'query' | 'body'
type Check = (value: unknown) => unknown

const fail = (field: string, message: string): never => { throw new ValidationError(field, message) }

// URL values are strings. Only canonical spellings convert: "01", "+1", "1e3", "-0" are refused.
const INT = /^(?:0|-?[1-9][0-9]*)$/
const NUMBER = /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/
const SCALAR = new Set(['string', 'id', 'uuid', 'email', 'money', 'int', 'number', 'bool', 'enum'])
// The WHATWG HTML rule for <input type="email">; the length is checked first (labels are at most 63).
const EMAIL = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/
// Lowercase only: one spelling per id, so "A..." and "a..." can never be two different keys.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

function bounded(field: string, n: number, min: number | undefined, max: number | undefined, unit: string): void {
  if (min !== undefined && n < min) fail(field, `must be at least ${min}${unit}`)
  if (max !== undefined && n > max) fail(field, `must be at most ${max}${unit}`)
}

function compile(def: SchemaDef, field: string, coerce: boolean): Check {
  switch (def.kind) {
    case 'string': {
      const { min, max, pattern } = def
      return (v) => {
        if (typeof v !== 'string') return fail(field, 'must be a string')
        bounded(field, v.length, min, max, ' characters') // length first: the pattern only sees bounded input
        if (pattern !== undefined && !pattern.test(v)) fail(field, 'has an invalid format')
        return v
      }
    }
    case 'id':
      return (v) => (typeof v === 'string' && v.length <= 200 && safeSegment(v) ? v : fail(field, 'must be a valid id'))
    case 'uuid':
      return (v) => (typeof v === 'string' && UUID.test(v) ? v : fail(field, 'must be a lowercase uuid'))
    case 'email': {
      const { max } = def
      // RFC 5321: at most 64 characters before the "@"
      return (v) => (typeof v === 'string' && v.length <= max && v.indexOf('@') <= 64 && EMAIL.test(v) ? v : fail(field, 'must be an email address'))
    }
    case 'money': {
      const { scale, min, max } = def
      const message = scale === 0 ? 'must be a whole amount as a string, such as "12"' : `must be an amount as a string with at most ${scale} decimals, such as "12.50"`
      return (v) => {
        const n = typeof v === 'string' ? toMinor(v, scale) : undefined // a JSON number is a float: never accepted
        if (n === undefined) return fail(field, message)
        if (min !== undefined && n < min) fail(field, `must be at least ${toDecimal(min, scale)}`)
        if (max !== undefined && n > max) fail(field, `must be at most ${toDecimal(max, scale)}`)
        return n
      }
    }
    case 'int': case 'number': {
      const { min, max } = def
      const isInt = def.kind === 'int'
      const what = isInt ? 'a whole number' : 'a number'
      return (v) => {
        let n = v
        if (coerce && typeof v === 'string') n = (isInt ? INT : NUMBER).test(v) ? Number(v) : NaN
        if (typeof n !== 'number' || !(isInt ? Number.isSafeInteger(n) : Number.isFinite(n)) || Object.is(n, -0)) return fail(field, `must be ${what}`)
        bounded(field, n, min, max, '')
        return n
      }
    }
    case 'bool':
      return (v) => {
        if (coerce && (v === 'true' || v === 'false')) return v === 'true'
        return typeof v === 'boolean' ? v : fail(field, 'must be true or false')
      }
    case 'enum': {
      const { values } = def
      const message = `must be one of: ${values.join(', ')}`
      return (v) => (typeof v === 'string' && values.includes(v) ? v : fail(field, message))
    }
    case 'array': {
      const { min, max } = def
      const prefix = field + '[]'
      const item = compile(def.item, prefix, coerce)
      return (v) => {
        if (!Array.isArray(v)) return fail(field, 'must be an array')
        bounded(field, v.length, min, max, ' items') // before touching any item
        const out = new Array<unknown>(v.length)
        for (let i = 0; i < v.length; i++) {
          try { out[i] = item(v[i]) } catch (e) {
            if (e instanceof ValidationError) e.field = `${field}[${i}]` + e.field.slice(prefix.length)
            throw e
          }
        }
        return out
      }
    }
    case 'object': {
      const fields = def.fields.map(([name, d]) => ({ name, def: d, check: compile(d, `${field}.${name}`, coerce), path: `${field}.${name}` }))
      return (v) => {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(field, 'must be an object')
        const out: Record<string, unknown> = {}
        for (const f of fields) {
          const raw = Object.hasOwn(v, f.name) ? (v as Record<string, unknown>)[f.name] : undefined
          if (raw === undefined) {
            if (f.def.hasDefault) out[f.name] = f.def.default
            else if (!f.def.optional) fail(f.path, 'is required')
          } else out[f.name] = f.check(raw)
        }
        return out
      }
    }
    case 'empty':
      throw new TypeError(`${field}: t.empty() describes a response, not an input`)
  }
}

/** Compile the schema of one input source. Throws a TypeError for a schema that source cannot carry. */
export function compileValidator(schema: unknown, source: Source): (value: unknown) => unknown {
  const def = toDef(schema)
  if (def.kind !== 'object') throw new TypeError(`${source} must be t.object({...})`)
  const coerce = source !== 'body'
  if (coerce) {
    for (const [name, field] of def.fields) {
      if (!SCALAR.has(field.kind)) throw new TypeError(`${source}.${name}: a URL value is a single string; use a scalar schema (string, id, uuid, email, money, int, number, bool, enum)`)
    }
  }
  return compile(def, source, coerce)
}
