// A small JSON Schema (2020-12) validator for the keywords pangol's OpenAPI output uses, so tests can
// check that the published schema and the runtime validator agree without a dependency.
type Schema = Readonly<Record<string, unknown>>

const typeOf = (v: unknown): string =>
  v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v === 'number' ? (Number.isInteger(v) ? 'integer' : 'number') : typeof v

/** True when `value` is valid against `schema`. Throws on a keyword it does not know, so no rule is skipped silently. */
export function validates(schema: Schema, value: unknown): boolean {
  for (const key of Object.keys(schema)) {
    if (!KNOWN.has(key) && !key.startsWith('x-')) throw new Error(`jsonschema helper: unknown keyword "${key}"`)
  }
  const type = schema['type']
  if (type !== undefined) {
    const t = typeOf(value)
    if (!(t === type || (type === 'number' && t === 'integer'))) return false
  }
  if (schema['enum'] !== undefined && !(schema['enum'] as unknown[]).includes(value)) return false
  if (typeof value === 'string') {
    const length = [...value].length // code points, as JSON Schema counts
    if (typeof schema['minLength'] === 'number' && length < schema['minLength']) return false
    if (typeof schema['maxLength'] === 'number' && length > schema['maxLength']) return false
    if (typeof schema['pattern'] === 'string' && !new RegExp(schema['pattern'], 'u').test(value)) return false
  }
  if (typeof value === 'number') {
    if (typeof schema['minimum'] === 'number' && value < schema['minimum']) return false
    if (typeof schema['maximum'] === 'number' && value > schema['maximum']) return false
  }
  if (Array.isArray(value)) {
    if (typeof schema['minItems'] === 'number' && value.length < schema['minItems']) return false
    if (typeof schema['maxItems'] === 'number' && value.length > schema['maxItems']) return false
    if (schema['items'] !== undefined && !value.every((item) => validates(schema['items'] as Schema, item))) return false
  }
  if (typeOf(value) === 'object') {
    const obj = value as Record<string, unknown>
    const properties = (schema['properties'] ?? {}) as Record<string, Schema>
    for (const name of (schema['required'] ?? []) as string[]) if (!Object.hasOwn(obj, name)) return false
    for (const [name, v] of Object.entries(obj)) {
      const p = properties[name]
      if (p !== undefined) { if (!validates(p, v)) return false } else if (schema['additionalProperties'] === false) return false
    }
  }
  return true
}

const KNOWN = new Set([
  'type', 'enum', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum', 'items', 'minItems', 'maxItems',
  'properties', 'required', 'additionalProperties', 'default', 'description', 'writeOnly',
])
