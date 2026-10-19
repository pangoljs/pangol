// Response serializers: write JSON for declared fields only, so undeclared data (password hashes,
// tokens, internal columns) can never leave the server. A value that does not match the schema is
// an error (-> 500 and a server log), never silently coerced.
import { toDef, type SchemaDef } from './def.js'
import { toDecimal } from '../money.js'

/** The handler returned something `response` does not describe. */
export class ResponseError {
  constructor(public path: string, readonly message: string) {}
}

type Write = (value: unknown) => string
const fail = (path: string, message: string): never => { throw new ResponseError(path, message) }

function compile(def: SchemaDef, path: string): Write {
  // SPEC C10: checked once at startup, so no request can ever reach a private field
  if (def.private) throw new TypeError(`${path} is .private() and can never be sent: use Model.public() or .omit(...) for the response`)
  switch (def.kind) {
    case 'string': case 'id': case 'uuid': case 'email':
      return (v) => (typeof v === 'string' ? JSON.stringify(v) : fail(path, 'must be a string'))
    case 'enum': {
      const { values } = def
      return (v) => (typeof v === 'string' && values.includes(v) ? JSON.stringify(v) : fail(path, `must be one of: ${values.join(', ')}`))
    }
    case 'money': {
      const { scale } = def
      // a number here would already be a float, so it is refused rather than formatted
      return (v) => (typeof v === 'bigint' ? '"' + toDecimal(v, scale) + '"' : fail(path, 'must be a bigint amount in minor units'))
    }
    case 'int':
      return (v) => (typeof v === 'number' && Number.isSafeInteger(v) ? JSON.stringify(v) : fail(path, 'must be a whole number'))
    case 'number':
      return (v) => (typeof v === 'number' && Number.isFinite(v) ? JSON.stringify(v) : fail(path, 'must be a finite number'))
    case 'bool':
      return (v) => (v === true ? 'true' : v === false ? 'false' : fail(path, 'must be a boolean'))
    case 'array': {
      const prefix = path + '[]'
      const item = compile(def.item, prefix)
      return (v) => {
        if (!Array.isArray(v)) return fail(path, 'must be an array')
        let out = '['
        for (let i = 0; i < v.length; i++) {
          try { out += (i === 0 ? '' : ',') + item(v[i]) } catch (e) {
            if (e instanceof ResponseError) e.path = `${path}[${i}]` + e.path.slice(prefix.length)
            throw e
          }
        }
        return out + ']'
      }
    }
    case 'object': {
      const fields = def.fields.map(([name, d]) => ({
        name, optional: d.optional || d.hasDefault, key: JSON.stringify(name) + ':', path: `${path}.${name}`, write: compile(d, `${path}.${name}`),
      }))
      return (v) => {
        if (typeof v !== 'object' || v === null || Array.isArray(v)) return fail(path, 'must be an object')
        let out = ''
        for (const f of fields) {
          const value = (v as Record<string, unknown>)[f.name] // getters and class fields count; toJSON does not
          if (value === undefined || value === null) {
            if (f.optional) continue
            fail(f.path, 'is missing')
          }
          out += (out === '' ? '{' : ',') + f.key + f.write(value)
        }
        return out === '' ? '{}' : out + '}'
      }
    }
    case 'empty':
      return () => fail(path, 't.empty() responses are sent with c.noContent()')
  }
}

export function compileSerializer(schema: unknown): (value: unknown) => string {
  const write = compile(toDef(schema), 'response')
  return (value) => (value === undefined ? fail('response', 'is missing') : write(value))
}
