// Generates two equivalent API projects with N = R * 10 routes:
//   out/<N>/hono   — Hono app, sub-app per resource chained with .route() (Hono's recommended RPC layout)
//   out/<N>/ours   — one file per route using our route() helper (file-based routing)
// Both use the same Zod schemas and the same handler bodies, plus a client file
// that makes the same calls.
import fs from 'node:fs'
import path from 'node:path'

const R = Number(process.argv[2] ?? 200) // resources
const N = R * 10
const root = path.resolve('out', String(N))
fs.rmSync(root, { recursive: true, force: true })

const w = (p, s) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s) }

// Each resource gets a distinct entity shape so TypeScript cannot dedupe types.
const entity = (k) => `z.object({
  id: z.string(),
  name_${k}: z.string().min(1).max(100),
  count_${k}: z.number().int(),
  active_${k}: z.boolean(),
  tags_${k}: z.array(z.string()),
  meta_${k}: z.object({ createdAt: z.string(), score_${k}: z.number().optional() }),
  status_${k}: z.enum(['draft', 'live', 'archived']),
})`
const item = (k) => `z.object({ itemId: z.string(), label_${k}: z.string(), qty_${k}: z.number() })`

// The 10 routes of a resource: [method, subpath, params, query, body, response]
const routes = [
  ['get', '', null, 'z.object({ page: z.coerce.number().optional(), q: z.string().optional() })', null, 'List'],
  ['get', ':id', 'ID', null, null, 'E'],
  ['post', '', null, null, 'E.omit({ id: true })', 'E'],
  ['put', ':id', 'ID', null, 'E.omit({ id: true })', 'E'],
  ['delete', ':id', 'ID', null, null, 'Ok'],
  ['get', ':id/items', 'ID', null, null, 'Items'],
  ['post', ':id/items', 'ID', null, 'I.omit({ itemId: true })', 'I'],
  ['get', ':id/items/:itemId', 'IDITEM', null, null, 'I'],
  ['patch', ':id/status', 'ID', null, `z.object({ status: E.shape.status_K })`, 'E'],
  ['get', 'search', null, 'z.object({ term: z.string() })', null, 'List'],
]
const paramSchema = { ID: 'z.object({ id: z.string() })', IDITEM: 'z.object({ id: z.string(), itemId: z.string() })' }
const schemaHeader = (k) => `import { z } from 'zod'
export const E = ${entity(k)}
export const I = ${item(k)}
export const List = z.object({ items: z.array(E), total: z.number() })
export const Ok = z.object({ ok: z.boolean() })
export const Items = z.array(I)
`

// ---------------- Hono ----------------
for (let k = 0; k < R; k++) {
  let s = `import { Hono } from 'hono'
import { zValidator } from '@hono/zod-validator'
${schemaHeader(k)}
export const r${k} = new Hono()`
  for (const [m, sub, p, q, b, resp] of routes) {
    const v = []
    if (p) v.push(`zValidator('param', ${paramSchema[p]})`)
    if (q) v.push(`zValidator('query', ${q})`)
    if (b) v.push(`zValidator('json', ${b.replace('_K', `_${k}`)})`)
    s += `\n  .${m}('/${sub}', ${v.map((x) => x + ', ').join('')}(c) => c.json({} as z.infer<typeof ${resp}>))`
  }
  w(path.join(root, 'hono/src', `r${k}.ts`), s + '\n')
}
w(path.join(root, 'hono/src/app.ts'),
  `import { Hono } from 'hono'\n` +
  Array.from({ length: R }, (_, k) => `import { r${k} } from './r${k}'`).join('\n') +
  `\nconst app = new Hono()\n` +
  Array.from({ length: R }, (_, k) => `  .route('/r${k}', r${k})`).join('\n') +
  `\nexport default app\nexport type AppType = typeof app\n`)

// ---------------- Ours ----------------
for (let k = 0; k < R; k++) {
  const dir = path.join(root, 'ours/src/routes', `r${k}`)
  w(path.join(dir, '_schema.ts'), schemaHeader(k))
  for (const [m, sub, p, q, b, resp] of routes) {
    const segs = sub ? sub.split('/').map((x) => (x.startsWith(':') ? `[${x.slice(1)}]` : x)) : []
    const last = segs.length && !segs[segs.length - 1].startsWith('[') && sub !== 'search' ? 'index' : null
    // file name: <segments>/<last or index>.<method>.ts
    let rel
    if (!sub) rel = `index.${m}.ts`
    else if (sub === 'search') rel = `search.${m}.ts`
    else {
      const leaf = segs[segs.length - 1]
      const parent = segs.slice(0, -1)
      rel = leaf.startsWith('[') ? path.join(...parent, `${leaf}.${m}.ts`) : path.join(...parent, leaf, `index.${m}.ts`)
    }
    void last
    const depth = rel.split(path.sep).length // files nested deeper need more ../
    const up = '../'.repeat(depth - 1) || './'
    const fields = []
    if (p) fields.push(`  params: ${paramSchema[p]},`)
    if (q) fields.push(`  query: ${q},`)
    if (b) fields.push(`  body: ${b.replace('_K', `_${k}`)},`)
    w(path.join(dir, rel), `import { z } from 'zod'
import { route } from '${'../'.repeat(depth + 5)}lib/hyper'
import { E, I, List, Ok, Items } from '${up}_schema'
void E; void I; void List; void Ok; void Items
export default route({
  auth: 'user',
${fields.join('\n')}
  response: ${resp},
  handler: (c) => { void c; return {} as z.infer<typeof ${resp}> },
})
`)
  }
}

// ---------------- Clients (same 50 calls) ----------------
const picks = Array.from({ length: 50 }, (_, i) => Math.floor((i * 7919) % R))
let hc = `import { hc } from 'hono/client'
import type { AppType } from './src/app'
const client = hc<AppType>('http://localhost')
export async function main() {
`
let oc = `import { createClient } from '../../../lib/client'
import type { Api } from './.hyper/api'
const api = createClient<Api>({ baseUrl: 'http://localhost' })
export async function main() {
`
picks.forEach((k, i) => {
  if (i % 2 === 0) {
    hc += `  { const r = await client.r${k}[':id'].$get({ param: { id: '1' } }); if (r.ok) { const d = await r.json(); d.name_${k}.toUpperCase() } }\n`
    oc += `  { const d = await api.get('/r${k}/:id', { params: { id: '1' } }); d.name_${k}.toUpperCase() }\n`
  } else {
    hc += `  { const r = await client.r${k}[':id'].items.$post({ param: { id: '1' }, json: { label_${k}: 'x', qty_${k}: 1 } }); if (r.ok) { const d = await r.json(); d.qty_${k}.toFixed() } }\n`
    oc += `  { const d = await api.post('/r${k}/:id/items', { params: { id: '1' }, body: { label_${k}: 'x', qty_${k}: 1 } }); d.qty_${k}.toFixed() }\n`
  }
})
w(path.join(root, 'hono/client.ts'), hc + '}\n')
w(path.join(root, 'ours/client.ts'), oc + '}\n')

// tsconfigs: server-only and client-only programs for each variant
const base = { compilerOptions: { target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', strict: true, noEmit: true, skipLibCheck: true, types: [] } }
for (const v of ['hono', 'ours']) {
  w(path.join(root, v, 'tsconfig.server.json'), JSON.stringify({ ...base, include: ['src/**/*.ts'] }, null, 2))
  w(path.join(root, v, 'tsconfig.client.json'), JSON.stringify({ ...base, files: ['client.ts'] }, null, 2))
}
console.log(`generated ${N} routes x 2 variants in ${root}`)
