import { lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export type Runtime = 'node' | 'bun'
export class UsageError extends Error {}

export function runtimeOf(value: string): Runtime {
  if (value !== 'node' && value !== 'bun') throw new UsageError('--runtime must be node or bun')
  return value
}

/** Validate the full destination before writing; never follow a destination symlink. */
export function createProject(directory: string, runtime: Runtime): string {
  const target = resolve(directory)
  const name = basename(target)
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name) || name.length > 214 || name === 'node_modules') {
    throw new UsageError('folder name must be a lowercase npm package name (letters, numbers, dots, underscores, hyphens)')
  }
  let existing
  try { existing = lstatSync(target) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (existing !== undefined && (!existing.isDirectory() || existing.isSymbolicLink() || readdirSync(target).length !== 0)) {
    throw new Error('destination must be a new or empty folder, not a file or symlink')
  }
  const template = fileURLToPath(new URL('../template/', import.meta.url))
  // Read/render before creating a destination, so a broken distribution leaves no partial project.
  const files: { path: string; content: string }[] = []
  const collect = (folder: string, relative: string) => {
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      const path = join(relative, entry.name)
      if (entry.isDirectory()) collect(join(folder, entry.name), path)
      else if (entry.isFile()) {
        files.push({ path: path === 'gitignore' ? '.gitignore' : path.replace(/\.template$/, ''), content: readFileSync(join(folder, entry.name), 'utf8')
          .replaceAll('__PROJECT_NAME__', name).replaceAll('__RUNTIME__', runtime)
          .replaceAll('__DEV_COMMAND__', runtime === 'node' ? 'node --watch --import pangol/register src/server.ts' : 'bun --watch src/server.ts')
          .replaceAll('__START_COMMAND__', runtime === 'node' ? 'node --import pangol/register src/server.ts' : 'bun src/server.ts')
          .replaceAll('__TEST_COMMAND__', runtime === 'node' ? 'node --import pangol/register --test test/app.test.ts' : 'bun test test/') })
      } else throw new Error(`unsupported template entry: ${path}`)
    }
  }
  collect(template, '')
  mkdirSync(target, { recursive: true })
  for (const file of files) {
    const dest = join(target, file.path)
    mkdirSync(resolve(dest, '..'), { recursive: true })
    writeFileSync(dest, file.content, { flag: 'wx' })
  }
  return target
}
