// IDE simulation with the TypeScript language service (the same engine VS Code uses).
// usage: node bench-ls.mjs <project dir> <hono|ours> <resource index K>
// Prints JSON: times in ms for
//   cold_route   first autocomplete on a fresh service: list routes of resource K
//   warm_route   same after an edit (service already warm)
//   resp_fields  autocomplete on the response object's fields
//   diag_edit    re-check the file after an edit (red squiggles refresh)
import ts from 'typescript'
import fs from 'node:fs'
import path from 'node:path'

const [dir, variant, K, R] = [path.resolve(process.argv[2]), process.argv[3], Number(process.argv[4] ?? 0), Number(process.argv[5] ?? 1)]
const k1 = (K + 1) % R, k2 = (K + 2) % R
const cfgPath = path.join(dir, 'tsconfig.client.json')
const cfg = ts.parseJsonConfigFileContent(ts.readConfigFile(cfgPath, ts.sys.readFile).config, ts.sys, dir)
const clientFile = path.join(dir, 'client.ts')
const original = fs.readFileSync(clientFile, 'utf8')

const files = new Map() // overrides for the client file
let version = 0
const host = {
  getScriptFileNames: () => cfg.fileNames,
  getScriptVersion: (f) => (f === clientFile ? String(version) : '0'),
  getScriptSnapshot: (f) => {
    const text = files.get(f) ?? (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : undefined)
    return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text)
  },
  getCurrentDirectory: () => dir,
  getCompilationSettings: () => cfg.options,
  getDefaultLibFileName: ts.getDefaultLibFilePath,
  fileExists: ts.sys.fileExists,
  readFile: ts.sys.readFile,
  readDirectory: ts.sys.readDirectory,
  directoryExists: ts.sys.directoryExists,
  getDirectories: ts.sys.getDirectories,
}
const ls = ts.createLanguageService(host, ts.createDocumentRegistry())

// Put `snippet` as a new line inside main() and return the cursor offset (marked by |).
function edit(snippet) {
  const at = original.lastIndexOf('}')
  const [a, b] = snippet.split('|')
  const text = original.slice(0, at) + '  ' + a + b + '\n' + original.slice(at)
  files.set(clientFile, text)
  version++
  return at + 2 + a.length
}
function time(fn) {
  const t = performance.now()
  const r = fn()
  return [Math.round(performance.now() - t), r]
}
const probes = variant === 'hono'
  ? { route: (k) => `client.r${k}.|`, resp: (k) => `void (async () => { const r = await client.r${k}[':id'].$get({ param: { id: '1' } }); if (r.ok) { const d = await r.json(); d.| } })` }
  : { route: (k) => `api.get('/r${k}|')`, resp: (k) => `void (async () => { const d = await api.get('/r${k}/:id', { params: { id: '1' } }); d.| })` }

const out = {}
let pos = edit(probes.route(K))
let [ms, c] = time(() => ls.getCompletionsAtPosition(clientFile, pos, {}))
out.cold_route = ms
out.cold_route_entries = c?.entries.length ?? 0
if (process.env.SHOW) console.error(c?.entries.map((e) => e.name).slice(0, 20))

pos = edit(probes.route(k1));
[ms, c] = time(() => ls.getCompletionsAtPosition(clientFile, pos, {}))
out.warm_route = ms

pos = edit(probes.resp(k2));
[ms, c] = time(() => ls.getCompletionsAtPosition(clientFile, pos, {}))
out.resp_fields = ms
out.resp_has_name = !!c?.entries.some((e) => e.name === `name_${k2}`)

edit(`void 0 // edit ${K}|`);
[ms] = time(() => ls.getSemanticDiagnostics(clientFile))
out.diag_edit = ms
console.log(JSON.stringify(out))
