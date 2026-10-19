import { readdirSync, existsSync, lstatSync, unlinkSync, mkdirSync, symlinkSync, chmodSync } from 'node:fs'
import { resolve } from 'node:path'

// Ensure pangol CLI binary is accessible in workspace .bin directories
// after packages/pangol is compiled, resolving pnpm cold-install linking issues.
const target = resolve('packages/pangol/dist/cli/main.js')
if (existsSync(target)) {
  try {
    chmodSync(target, 0o755)
  } catch {}
  const dirs = ['.', ...(existsSync('examples') ? readdirSync('examples').map((d) => `examples/${d}`) : [])]
  for (const dir of dirs) {
    const binDir = resolve(dir, 'node_modules/.bin')
    const binPath = resolve(binDir, 'pangol')
    try {
      mkdirSync(binDir, { recursive: true })
      try {
        if (lstatSync(binPath)) unlinkSync(binPath)
      } catch {}
      symlinkSync(target, binPath)
    } catch {}
  }
}
