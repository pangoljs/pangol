// Schema builder `t`. Schemas are plain data plus .optional() / .default().
// validate(): input side (params, query, body) — builds a NEW value with declared keys only.
// output(): response side — copies declared keys only, so undeclared fields never leave the server.

class Schema {
  constructor(kind, opts) { this.kind = kind; Object.assign(this, opts) }
  optional() { return Object.assign(Object.create(Schema.prototype), this, { isOptional: true }) }
  default(value) { return Object.assign(Object.create(Schema.prototype), this, { isOptional: true, hasDefault: true, defaultValue: value }) }
}
export const isSchema = (x) => x instanceof Schema

const toRegExp = (p) => (p === undefined ? undefined : p instanceof RegExp ? p : new RegExp(p))
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX = Number.MAX_SAFE_INTEGER

export const t = {
  string: (o = {}) => new Schema('string', { min: o.min ?? 0, max: o.max ?? 10_000, pattern: toRegExp(o.pattern) }),
  email: (o = {}) => new Schema('email', { max: o.max ?? 254 }),
  int: (o = {}) => new Schema('int', { min: o.min ?? -MAX, max: o.max ?? MAX }),
  number: (o = {}) => new Schema('number', { min: o.min ?? -Infinity, max: o.max ?? Infinity }),
  bool: () => new Schema('bool', {}),
  enum: (values) => {
    if (!Array.isArray(values) || values.length === 0) throw new Error('t.enum([...]) needs a non-empty array of strings')
    return new Schema('enum', { values })
  },
  array: (item, o = {}) => {
    if (!isSchema(item)) throw new Error('t.array(item) needs a schema, e.g. t.array(t.string())')
    return new Schema('array', { item, min: o.min ?? 0, max: o.max ?? 1000 })
  },
  object: (shape) => {
    if (shape === null || typeof shape !== 'object' || isSchema(shape)) throw new Error('t.object({...}) needs an object of schemas')
    for (const [k, v] of Object.entries(shape)) if (!isSchema(v)) throw new Error(`t.object: field "${k}" is not a schema (use t.string(), t.int(), ...)`)
    return new Schema('object', { shape })
  },
  // response of a route that returns c.noContent()
  empty: () => new Schema('empty', {}),
}

export class ValidationError { constructor(path, message) { this.path = path; this.message = message } }
const bad = (path, message) => { throw new ValidationError(path, message) }

// coerce: values come from the URL (params/query) and are strings
export function validate(s, v, path, coerce) {
  if (v === undefined || (coerce && v === '')) {
    if (s.hasDefault) return s.defaultValue
    if (s.isOptional) return undefined
    return bad(path, 'is required')
  }
  switch (s.kind) {
    case 'string':
      if (typeof v !== 'string') return bad(path, 'must be a string')
      if (v.length < s.min) return bad(path, s.min === 1 ? 'must not be empty' : `must be at least ${s.min} characters`)
      if (v.length > s.max) return bad(path, `must be at most ${s.max} characters`)
      if (s.pattern && !s.pattern.test(v)) return bad(path, 'has an invalid format')
      return v
    case 'email':
      if (typeof v !== 'string' || v.length > s.max || !EMAIL.test(v)) return bad(path, 'must be a valid email')
      return v
    case 'int':
    case 'number': {
      let n = v
      if (coerce && typeof v === 'string') n = /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN
      if (typeof n !== 'number' || !Number.isFinite(n)) return bad(path, `must be a ${s.kind === 'int' ? 'whole number' : 'number'}`)
      if (s.kind === 'int' && !Number.isInteger(n)) return bad(path, 'must be a whole number')
      if (n < s.min) return bad(path, `must be at least ${s.min}`)
      if (n > s.max) return bad(path, `must be at most ${s.max}`)
      return n
    }
    case 'bool':
      if (coerce && (v === 'true' || v === 'false')) return v === 'true'
      if (typeof v !== 'boolean') return bad(path, 'must be true or false')
      return v
    case 'enum':
      if (!s.values.includes(v)) return bad(path, `must be one of: ${s.values.join(', ')}`)
      return v
    case 'array': {
      if (!Array.isArray(v)) return bad(path, 'must be an array')
      if (v.length < s.min) return bad(path, `must have at least ${s.min} items`)
      if (v.length > s.max) return bad(path, `must have at most ${s.max} items`)
      return v.map((x, i) => validate(s.item, x, `${path}[${i}]`, false))
    }
    case 'object': {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) return bad(path || 'body', 'must be an object')
      const out = {}
      for (const [k, fs] of Object.entries(s.shape)) {
        const r = validate(fs, Object.hasOwn(v, k) ? v[k] : undefined, path ? `${path}.${k}` : k, coerce)
        if (r !== undefined) out[k] = r
      }
      return out
    }
    default:
      return bad(path, 'cannot be validated')
  }
}

export class ResponseError { constructor(path, message) { this.path = path; this.message = message } }
export function output(s, v, path = 'response') {
  if (v === undefined || v === null) {
    if (s.isOptional) return undefined
    throw new ResponseError(path, 'is missing')
  }
  switch (s.kind) {
    case 'string': case 'email': case 'enum':
      if (typeof v !== 'string') throw new ResponseError(path, 'must be a string')
      return v
    case 'int': case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) throw new ResponseError(path, 'must be a number')
      return v
    case 'bool':
      if (typeof v !== 'boolean') throw new ResponseError(path, 'must be a boolean')
      return v
    case 'array':
      if (!Array.isArray(v)) throw new ResponseError(path, 'must be an array')
      return v.map((x, i) => output(s.item, x, `${path}[${i}]`))
    case 'object': {
      if (typeof v !== 'object' || Array.isArray(v)) throw new ResponseError(path, 'must be an object')
      const out = {}
      for (const [k, fs] of Object.entries(s.shape)) {
        const r = output(fs, v[k], `${path}.${k}`)
        if (r !== undefined) out[k] = r
      }
      return out
    }
    default:
      throw new ResponseError(path, `unsupported response schema "${s.kind}"`)
  }
}
