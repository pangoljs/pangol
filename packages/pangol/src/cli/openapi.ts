// `pangol openapi` (SPEC section 11): an OpenAPI 3.1 document of the loaded routes. Every schema says
// exactly what the validator accepts: the patterns for id, uuid, email and money are the ones the
// validator runs (a property test checks the two agree). What JSON Schema cannot say (money bounds,
// regex flags) goes into x-pangol-* extensions rather than being left out silently.
import type TS from 'typescript'
import { toDecimal } from '../money.js'
import { toDef, type SchemaDef } from '../runtime/def.js'
import { EMAIL, UUID } from '../runtime/validate.js'
import { Schema } from '../schema.js'
import { analyze } from './analyze.js'
import type { CheckResult } from './check.js'

type Json = Record<string, unknown>
/** Input schemas accept and drop undeclared keys; output schemas never contain them. */
export type Direction = 'input' | 'output'

// safeSegment(): 1-200 characters, not "." or "..", no "/", "\" or control characters
const ID_PATTERN = '^(?!\\.\\.?$)[^\\u0000-\\u001f\\u007f/\\\\]+$'
// the validator also requires at most 64 characters before the "@" (RFC 5321)
const EMAIL_PATTERN = '^(?=[^@]{1,64}@)' + EMAIL.source.slice(1)
const MAX_MONEY_LENGTH = 64

function moneyPattern(scale: number, negative: boolean): string {
  const fraction = scale === 0 ? '' : `(?:\\.[0-9]{1,${scale}})?`
  const minusZero = scale === 0 ? '(?!-0$)' : '(?!-0(?:\\.0+)?$)'
  return `^${negative ? minusZero + '-?' : ''}(?:0|[1-9][0-9]*)${fraction}$`
}

function money(def: Extract<SchemaDef, { kind: 'money' }>): Json {
  const { scale, min, max, currency } = def
  const show = (v: bigint) => toDecimal(v, scale)
  const range = min !== undefined && max !== undefined ? `from ${show(min)} to ${show(max)}`
    : min !== undefined ? `at least ${show(min)}` : max !== undefined ? `at most ${show(max)}` : ''
  const parts = [`Decimal amount as a string, ${scale === 0 ? 'no decimals' : `at most ${scale} decimals`}`, range].filter(Boolean).join(', ')
  return {
    type: 'string', maxLength: MAX_MONEY_LENGTH, pattern: moneyPattern(scale, min === undefined || min < 0n),
    description: parts + (currency === undefined ? '' : ` ${currency}`),
    'x-pangol-money': { scale, ...(currency !== undefined && { currency }), ...(min !== undefined && { minimum: show(min) }), ...(max !== undefined && { maximum: show(max) }) },
  }
}

function convert(def: SchemaDef, direction: Direction): Json {
  const out = base(def, direction)
  if (def.hasDefault) out['default'] = typeof def.default === 'bigint' && def.kind === 'money' ? toDecimal(def.default, def.scale) : def.default
  if (def.private) out['writeOnly'] = true // accepted as input, never sent
  return out
}

function base(def: SchemaDef, direction: Direction): Json {
  switch (def.kind) {
    case 'string': {
      const { min, max, pattern } = def
      return {
        type: 'string', ...(min !== undefined && { minLength: min }), ...(max !== undefined && { maxLength: max }),
        ...(pattern !== undefined && (pattern.flags === '' ? { pattern: pattern.source } : { 'x-pangol-pattern': { source: pattern.source, flags: pattern.flags } })),
      }
    }
    case 'id': return { type: 'string', minLength: 1, maxLength: 200, pattern: ID_PATTERN }
    case 'uuid': return { type: 'string', format: 'uuid', pattern: UUID.source }
    case 'email': return { type: 'string', format: 'email', maxLength: def.max, pattern: EMAIL_PATTERN }
    case 'money': return money(def)
    case 'int': return { type: 'integer', minimum: def.min ?? -Number.MAX_SAFE_INTEGER, maximum: def.max ?? Number.MAX_SAFE_INTEGER }
    case 'number': return { type: 'number', ...(def.min !== undefined && { minimum: def.min }), ...(def.max !== undefined && { maximum: def.max }) }
    case 'bool': return { type: 'boolean' }
    case 'enum': return { type: 'string', enum: [...def.values] }
    case 'array': return { type: 'array', ...(def.min !== undefined && { minItems: def.min }), ...(def.max !== undefined && { maxItems: def.max }), items: convert(def.item, direction) }
    case 'object': return {
      type: 'object',
      properties: Object.fromEntries(def.fields.map(([name, field]) => [name, convert(field, direction)])),
      required: def.fields.filter(([, f]) => !f.optional && !f.hasDefault).map(([name]) => name),
      ...(direction === 'output' && { additionalProperties: false }),
    }
    case 'empty': return {}
  }
}

/** JSON Schema (2020-12) of a pangol schema. */
export const jsonSchema = (schema: unknown, direction: Direction): Json => convert(toDef(schema), direction)

// ------------------------------------------------------------------ the document

const ERROR_TEXT: Record<number, string> = {
  400: 'Invalid path or input', 401: 'Missing or invalid credentials', 403: 'Not allowed', 404: 'Not found',
  409: 'Conflict', 413: 'Body too large', 415: 'Body is not JSON', 422: 'Unprocessable', 429: 'Too many requests', 500: 'Internal error',
}
const ERROR_SCHEMA = {
  type: 'object', required: ['error'], additionalProperties: false,
  properties: { error: { type: 'string' }, field: { type: 'string' } },
}
const UNSAFE = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

function operationId(method: string, path: string): string {
  const words = path.split('/').filter(Boolean).map((s) => (s.startsWith(':') ? 'By' + cap(s.slice(1)) : s.split(/[-_.~]/).map(cap).join('')))
  return method.toLowerCase() + (words.length === 0 ? 'Root' : words.join(''))
}
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export function openApi(result: CheckResult, ts: typeof TS, info: { readonly title: string; readonly version: string }): Json {
  const auth = result.auth
  const scheme = auth === undefined ? undefined : auth.from === 'bearer' ? 'bearer' : 'cookie'
  const paths: Record<string, Record<string, Json>> = {}
  const ids = new Set<string>()

  for (const { key, definition: d } of result.routes) {
    const space = key.indexOf(' ')
    const method = key.slice(0, space), path = key.slice(space + 1)
    const a = typeof d['handler'] === 'function' ? analyze(ts, d['handler'] as (...args: never[]) => unknown) : undefined
    const routeAuth = d['auth'] as string | { permission: string }

    const names = path.split('/').filter((s) => s.startsWith(':')).map((s) => s.slice(1))
    const params = d['params'] instanceof Schema ? toDef(d['params']) : undefined
    const paramFields = new Map(params?.kind === 'object' ? params.fields : [])
    const parameters: Json[] = names.map((name) => {
      const field = paramFields.get(name)
      return { name, in: 'path', required: true, schema: field === undefined ? base({ kind: 'id', optional: false, hasDefault: false, private: false }, 'input') : convert(field, 'input') }
    })
    const query = d['query'] instanceof Schema ? toDef(d['query']) : undefined
    if (query?.kind === 'object') {
      for (const [name, field] of query.fields) parameters.push({ name, in: 'query', required: !field.optional && !field.hasDefault, schema: convert(field, 'input') })
    }

    const response = d['response'] instanceof Schema ? toDef(d['response']) : undefined
    const responses: Record<string, Json> = {}
    if (response?.kind === 'empty') responses['204'] = { description: 'No content' }
    else {
      const content = { 'application/json': { schema: response === undefined ? {} : convert(response, 'output') } }
      // c.created(...) answers 201 (read from the handler's AST); otherwise a returned value is 200
      responses[a?.reads.has('created') === true ? '201' : '200'] = { description: a?.reads.has('created') === true ? 'Created' : 'OK', content }
    }
    const errors = new Set([400, 500])
    if (routeAuth !== 'public') errors.add(401)
    if (typeof routeAuth === 'object' || (scheme === 'cookie' && routeAuth !== 'public' && UNSAFE.has(method))) errors.add(403)
    if (d['load'] !== undefined) errors.add(404)
    if (d['body'] !== undefined) { errors.add(413); errors.add(415) }
    if (d['rateLimit'] !== undefined) errors.add(429)
    for (const status of a?.failStatuses ?? []) if (typeof status === 'number') errors.add(status)
    for (const status of errors) {
      responses[String(status)] = { description: ERROR_TEXT[status] ?? 'Error', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } }
    }

    let id = operationId(method, path)
    for (let n = 2; ids.has(id); n++) id = operationId(method, path) + n
    ids.add(id)
    const required = scheme === undefined ? [] : [{ [scheme]: [] }]
    const owner = d['owner']
    ;(paths[path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}')] ??= {})[method.toLowerCase()] = {
      operationId: id,
      ...(typeof d['description'] === 'string' && { description: d['description'] }),
      ...(parameters.length > 0 && { parameters }),
      ...(d['body'] instanceof Schema && { requestBody: { required: true, content: { 'application/json': { schema: jsonSchema(d['body'], 'input') } } } }),
      responses,
      security: routeAuth === 'public' ? [] : routeAuth === 'optional' ? [{}, ...required] : required,
      ...(typeof routeAuth === 'object' && { 'x-pangol-permission': routeAuth.permission }),
      ...(owner !== undefined && { 'x-pangol-owner': typeof owner === 'function' ? 'function' : owner }),
    }
  }

  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://spec.openapis.org/oas/3.1/dialect/base',
    info: { title: info.title, version: info.version },
    paths,
    components: {
      schemas: { Error: ERROR_SCHEMA },
      ...(auth !== undefined && {
        securitySchemes: auth.from === 'bearer'
          ? { bearer: { type: 'http', scheme: 'bearer' } }
          : { cookie: { type: 'apiKey', in: 'cookie', name: auth.from.cookie } },
      }),
    },
  }
}
