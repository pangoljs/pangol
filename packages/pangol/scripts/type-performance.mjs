// Server declaration benchmark, distinct from generated client/IDE targets in SPEC §14.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const compiler = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
const source = fileURLToPath(new URL('../src/index.js', import.meta.url))
const directory = mkdtempSync(join(tmpdir(), 'pangol-type-performance-'))
try {
  writeFileSync(join(directory, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true,
      noEmit: true, skipLibCheck: true, types: [],
    },
    files: ['routes.mts'],
  }))
  for (const count of [1, 2_000]) {
    const routes = Array.from({ length: count }, (_, i) => `
export const route${i} = route({
  auth: 'user',
  params: t.object({ id: t.id() }),
  body: t.object({ title: t.string() }),
  response: t.object({ id: t.id(), title: t.string() }),
  load: async (c) => ({ id: c.params.id, title: 'Post ${i}', authorId: 'user' }),
  owner: (c, post) => post.authorId === c.user.id,
  handler: (c) => ({ id: c.resource.id, title: c.body.title }),
})`).join('\n')
    writeFileSync(join(directory, 'routes.mts'), `import { route, t } from ${JSON.stringify(source)}\n${routes}\n`)
    const diagnostics = execFileSync(process.execPath, [compiler, '-p', join(directory, 'tsconfig.json'), '--extendedDiagnostics'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    })
    const metrics = diagnostics.split('\n').filter(line => /^(Types|Instantiations|Memory used|Check time|Total time):/.test(line))
    console.log(`${count} route(s)\n${metrics.join('\n')}`)
  }
} finally {
  rmSync(directory, { recursive: true, force: true })
}
