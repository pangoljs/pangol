// Manifests of other git revisions for `pangol diff main` / `diff main..HEAD`. Each revision is
// checked out into a temporary worktree and loaded fresh: a manifest committed to the repository is
// never trusted, since whoever changes a route can change that file too (SPEC section 10).
/// <reference types="node" />
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'

const git = (cwd: string, args: readonly string[]) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

/** Runs `use` with the project folder as it is at `ref`. */
export async function atRevision<T>(root: string, ref: string, use: (projectRoot: string) => Promise<T>): Promise<T> {
  if (ref.startsWith('-') || ref.trim() === '') throw new Error(`"${ref}" is not a git revision`)
  const top = git(root, ['rev-parse', '--show-toplevel'])
  let commit: string
  try { commit = git(root, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`]) } catch {
    throw new Error(`"${ref}" is not a git revision here (a branch, tag or commit; fetch it first in CI)`)
  }
  const tree = mkdtempSync(join(tmpdir(), 'pangol-diff-'))
  try {
    git(top, ['worktree', 'add', '--detach', '--quiet', tree, commit])
    // dependencies are not in git: reuse the installed ones
    for (let dir = root; ; dir = dirname(dir)) {
      const modules = join(dir, 'node_modules')
      const target = join(tree, relative(top, dir), 'node_modules')
      if (existsSync(modules) && existsSync(dirname(target)) && !existsSync(target)) symlinkSync(modules, target, 'dir')
      if (dir === top || dir === dirname(dir)) break
    }
    return await use(join(tree, relative(top, root)))
  } finally {
    try { git(top, ['worktree', 'remove', '--force', tree]) } catch { rmSync(tree, { recursive: true, force: true }) }
  }
}
