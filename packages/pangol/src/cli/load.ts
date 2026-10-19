/// <reference types="node" />
// Loading a TypeScript project from the CLI without a build step or a dependency. Bun runs .ts as
// is. Node 22.18+ strips types; it only lacks the TypeScript habit of importing "./x.js" for
// "./x.ts", so a resolve hook retries a missing relative .js as .ts.
import module from 'node:module'

interface ResolveContext { readonly parentURL?: string | undefined }
type Resolve = (specifier: string, context: ResolveContext) => unknown
interface Hooks { resolve(specifier: string, context: ResolveContext, next: Resolve): unknown }

let registered = false

export function enableTypeScriptImports(): void {
  if (registered || 'Bun' in globalThis) return
  const register = (module as { registerHooks?: (hooks: Hooks) => unknown }).registerHooks
  if (typeof register !== 'function') return
  registered = true
  register({
    resolve(specifier, context, next) {
      try { return next(specifier, context) } catch (e) {
        const relative = specifier.startsWith('./') || specifier.startsWith('../')
        if (!relative || !/\.m?js$/.test(specifier) || (e as { code?: unknown }).code !== 'ERR_MODULE_NOT_FOUND') throw e
        return next(specifier.replace(/js$/, 'ts'), context)
      }
    },
  })
}

/** Can this runtime import .ts files? */
export const canImportTypeScript = (): boolean =>
  'Bun' in globalThis || Boolean((process.features as { typescript?: unknown }).typescript)
