import fc from 'fast-check'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { check, type LoadedRoute } from '../../src/cli/check.js'
import { jsonSchema, openApi } from '../../src/cli/openapi.js'
import { defineAuth, route, t } from '../../src/index.js'
import { compileValidator } from '../../src/runtime/validate.js'
import { validates } from '../helpers/jsonschema.js'

const root = fileURLToPath(new URL('./fixtures/good', import.meta.url))
const input = (s: Parameters<typeof jsonSchema>[0]) => jsonSchema(s, 'input')
const output = (s: Parameters<typeof jsonSchema>[0]) => jsonSchema(s, 'output')

describe('schema -> JSON Schema', () => {
  it('describes each kind with the limits the validator applies', () => {
    expect(input(t.string({ min: 1, max: 5, pattern: /^[a-z]+$/ }))).toEqual({ type: 'string', minLength: 1, maxLength: 5, pattern: '^[a-z]+$' })
    expect(input(t.string())).toEqual({ type: 'string', maxLength: 10_000 })
    expect(input(t.int({ min: 0 }))).toEqual({ type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER })
    expect(input(t.number({ max: 1.5 }))).toEqual({ type: 'number', maximum: 1.5 })
    expect(input(t.bool())).toEqual({ type: 'boolean' })
    expect(input(t.enum(['a', 'b']))).toEqual({ type: 'string', enum: ['a', 'b'] })
    expect(input(t.array(t.int(), { max: 3 }))).toEqual({ type: 'array', maxItems: 3, items: { type: 'integer', minimum: -Number.MAX_SAFE_INTEGER, maximum: Number.MAX_SAFE_INTEGER } })
    expect(input(t.uuid())).toMatchObject({ type: 'string', format: 'uuid' })
    expect(input(t.email({ max: 100 }))).toMatchObject({ type: 'string', format: 'email', maxLength: 100 })
    expect(input(t.id())).toMatchObject({ type: 'string', minLength: 1, maxLength: 200 })
  })

  it('money is a decimal string, with its scale, currency and bounds as an extension', () => {
    expect(input(t.money({ currency: 'THB', min: '0.01', max: '500' }))).toEqual({
      type: 'string', maxLength: 64, pattern: '^(?:0|[1-9][0-9]*)(?:\\.[0-9]{1,2})?$',
      description: 'Decimal amount as a string, at most 2 decimals, from 0.01 to 500.00 THB',
      'x-pangol-money': { scale: 2, currency: 'THB', minimum: '0.01', maximum: '500.00' },
    })
    // negatives only when min allows them; -0 is never valid
    expect(input(t.money({ scale: 0, min: '-5' })).pattern).toBe('^(?!-0$)-?(?:0|[1-9][0-9]*)$')
  })

  it('objects: required, defaults, extra keys and private fields', () => {
    const shape = t.object({ name: t.string(), note: t.string().optional(), page: t.int().default(1), price: t.money().default(250n), secret: t.string().private() })
    const body = input(shape)
    expect(body).toMatchObject({ type: 'object', required: ['name', 'secret'] })
    expect(body).not.toHaveProperty('additionalProperties') // undeclared input is dropped, not refused
    expect((body.properties as Record<string, object>)['page']).toMatchObject({ default: 1 })
    expect((body.properties as Record<string, object>)['price']).toMatchObject({ default: '2.50' }) // the wire form
    expect((body.properties as Record<string, object>)['secret']).toMatchObject({ writeOnly: true })
    const out = output(t.object({ id: t.id(), note: t.string().optional() }))
    expect(out).toMatchObject({ additionalProperties: false, required: ['id'] }) // nothing undeclared is ever sent
  })

  it('a pattern with flags cannot be a JSON Schema pattern: it is kept as an extension instead', () => {
    expect(input(t.string({ pattern: /^a+$/i }))).toEqual({ type: 'string', maxLength: 10_000, 'x-pangol-pattern': { source: '^a+$', flags: 'i' } })
  })
})

// Money bounds other than the sign (min "0" vs negative) cannot be a regex: they are in x-pangol-money,
// so this property uses money fields without such bounds being crossed.
describe('the JSON Schema accepts exactly what the validator accepts', () => {
  const shape = t.object({
    id: t.id(), ref: t.uuid(), email: t.email(), amount: t.money(), delta: t.money({ min: '-100.00' }), name: t.string({ min: 2, max: 8 }),
    code: t.string({ pattern: /^[A-Z]{3}$/ }), count: t.int({ min: 0, max: 10 }), ratio: t.number(), on: t.bool(), kind: t.enum(['a', 'b']),
    tags: t.array(t.string({ max: 3 }), { max: 2 }), note: t.string().optional(), page: t.int().default(1),
  })
  const validate = compileValidator(shape, 'body')
  const schema = input(shape)
  const accepts = (v: unknown) => { try { validate(v); return true } catch { return false } }
  // -0 is the one value JSON Schema cannot tell apart from 0; the validator refuses it
  const json = fc.jsonValue().filter((v) => !Object.is(v, -0))
  const samples = ['', '.', '..', 'a/b', 'a\\b', 'ok', 'x'.repeat(201), 'ada@example.com', 'a@b', `${'a'.repeat(64)}@x.io`, `${'a'.repeat(65)}@x.io`, 'a..b@x', '0190a8f2-7c1e-7d3a-9b4e-1f2a3b4c5d6e',
      '0190A8F2-7C1E-7D3A-9B4E-1F2A3B4C5D6E', '12.50', '12.5', '12.505', '-1.00', '-0.00', '-99.99', '1'.repeat(70), '012', '1e3', 'ABC', 'ABCD', 'a', 'b', 'c', 'abc', 'abcd',
    0, 1, 10, 11, -1, 1.5, true, null, [], ['a'], ['a', 'abc', 'x'], ['abcd'], {}]
  const field = fc.oneof(
    json,
    fc.constantFrom(...samples),
    fc.integer({ min: -20, max: 20 }), fc.double({ noNaN: true, noDefaultInfinity: true }).filter((n) => !Object.is(n, -0)),
    fc.array(fc.constantFrom('a', 'abc', 'abcd', 1), { maxLength: 3 }),
  )
  const valid = { id: 'p1', ref: '0190a8f2-7c1e-7d3a-9b4e-1f2a3b4c5d6e', email: 'a@b.co', amount: '1.00', delta: '-2.50', name: 'ab', code: 'ABC', count: 1, ratio: 0.5, on: true, kind: 'a', tags: ['a'] }

  it('agrees on every edge-case sample in every field', () => {
    for (const key of Object.keys(valid).concat('note', 'page')) {
      for (const value of samples) {
        const v = { ...valid, [key]: value }
        expect(validates(schema, v), `${key} = ${JSON.stringify(value)}`).toBe(accepts(v))
      }
    }
  })

  it('agrees on a valid object with one field changed at random', () => {
    fc.assert(fc.property(fc.constantFrom(...Object.keys(shape.options['properties'] as object)), field, fc.boolean(), (key, value, drop) => {
      const v: Record<string, unknown> = { ...valid, [key]: value }
      if (drop) delete v[key]
      expect(validates(schema, v), JSON.stringify(v)).toBe(accepts(v))
    }), { numRuns: 5_000 })
  })

  it('agrees on arbitrary JSON', () => {
    fc.assert(fc.property(json, (v) => { expect(validates(schema, v)).toBe(accepts(v)) }), { numRuns: 2_000 })
  })
})

describe('the OpenAPI document', async () => {
  const result = await check({ root, ts })
  const doc = openApi(result, ts, { title: 'Blog', version: '1.2.3' }) as any // eslint-disable-line @typescript-eslint/no-explicit-any

  it('is OpenAPI 3.1 with the project title and version', () => {
    expect(doc.openapi).toBe('3.1.0')
    expect(doc.info).toEqual({ title: 'Blog', version: '1.2.3' })
    expect(doc.jsonSchemaDialect).toBe('https://spec.openapis.org/oas/3.1/dialect/base')
    expect(Object.keys(doc.paths)).toEqual(['/health', '/posts/{id}', '/posts/{id}/publish', '/posts'])
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)
  })

  it('auth becomes security: bearer scheme, public routes open, permissions named', () => {
    expect(doc.components.securitySchemes).toEqual({ bearer: { type: 'http', scheme: 'bearer' } })
    expect(doc.paths['/health'].get.security).toEqual([])
    expect(doc.paths['/posts'].get.security).toEqual([{ bearer: [] }])
    expect(doc.paths['/posts/{id}/publish'].post).toMatchObject({ security: [{ bearer: [] }], 'x-pangol-permission': 'admin' })
  })

  it('parameters, body and responses', () => {
    const patch = doc.paths['/posts/{id}'].patch
    expect(patch.operationId).toBe('patchPostsById')
    expect(patch.parameters).toEqual([{ name: 'id', in: 'path', required: true, schema: expect.objectContaining({ type: 'string', maxLength: 200 }) }])
    expect(patch.requestBody).toEqual({ required: true, content: { 'application/json': { schema: expect.objectContaining({ type: 'object', required: [] }) } } })
    expect(Object.keys(patch.responses)).toEqual(['200', '400', '401', '404', '413', '415', '500'])
    expect(patch.responses['200'].content['application/json'].schema).toMatchObject({ additionalProperties: false, required: ['id', 'authorId', 'title', 'price'] })
    expect(patch['x-pangol-owner']).toBe('function')

    const list = doc.paths['/posts'].get
    expect(list.parameters).toEqual([{ name: 'limit', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 50, default: 20 } }])
    expect(list.responses['200'].content['application/json'].schema.type).toBe('array')

    // c.created -> 201, c.fail(409) -> 409, rate limit -> 429, description kept, private field write-only
    const create = doc.paths['/posts'].post
    expect(Object.keys(create.responses)).toEqual(['201', '400', '401', '409', '413', '415', '429', '500'])
    expect(create.description).toBe('Create a post')
    expect(create.requestBody.content['application/json'].schema.properties.notes).toMatchObject({ writeOnly: true })
    expect(create.responses['409'].content['application/json'].schema).toEqual({ $ref: '#/components/schemas/Error' })

    expect(Object.keys(doc.paths['/posts/{id}/publish'].post.responses)).toEqual(['204', '400', '401', '403', '500'])
    expect(doc.paths['/posts/{id}/publish'].post.responses['204']).toEqual({ description: 'No content' })
    expect(doc.components.schemas.Error).toEqual({
      type: 'object', required: ['error'], additionalProperties: false,
      properties: { error: { type: 'string' }, field: { type: 'string' } },
    })
  })
})

describe('cookie auth and optional routes', () => {
  const auth = defineAuth({ from: { cookie: 'sid' }, resolve: () => null })
  const routes: LoadedRoute[] = [
    { key: 'GET /feed' as const, file: 'src/routes/feed.get.ts', definition: route({ auth: 'optional', response: t.string(), handler: () => 'x' }) as unknown as LoadedRoute['definition'] },
    { key: 'POST /notes' as const, file: 'src/routes/notes.post.ts', definition: route({ auth: 'user', body: t.object({ text: t.string() }), response: t.empty(), handler: (c) => c.noContent() }) as unknown as LoadedRoute['definition'] },
  ]
  const doc = openApi({ findings: [], routes, auth }, ts, { title: 'x', version: '1' }) as any // eslint-disable-line @typescript-eslint/no-explicit-any

  it('a cookie is an apiKey scheme; optional auth lists "no credential" as an alternative', () => {
    expect(doc.components.securitySchemes).toEqual({ cookie: { type: 'apiKey', in: 'cookie', name: 'sid' } })
    expect(doc.paths['/feed'].get.security).toEqual([{}, { cookie: [] }])
    expect(doc.paths['/notes'].post.security).toEqual([{ cookie: [] }])
  })

  it('unsafe methods with cookie auth can answer 403 (cross-origin protection)', () => {
    expect(Object.keys(doc.paths['/notes'].post.responses)).toContain('403')
    expect(Object.keys(doc.paths['/feed'].get.responses)).not.toContain('403')
  })
})
