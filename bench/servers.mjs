// Starting a benchmark server, optionally pinned to one CPU.
import { spawn } from 'node:child_process'

export const SERVERS = {
  'raw-bun': ['bun', 'servers/raw-bun.mjs'],
  'raw-node': ['node', 'servers/raw-node.mjs'],
  'pangol-bun': ['bun', 'servers/pangol-bun.mjs'],
  'pangol-node': ['node', 'servers/pangol-node.mjs'],
  'elysia-bun': ['bun', 'servers/elysia-bun.mjs'],
  'hono-bun': ['bun', 'servers/hono-bun.mjs'],
  'hono-node': ['node', 'servers/hono-node.mjs'],
}

export async function start(name, port, cpu) {
  const [cmd, file] = SERVERS[name]
  const [bin, args] = cpu === undefined ? [cmd, [file]] : ['taskset', ['-c', String(cpu), cmd, file]]
  const p = spawn(bin, args, { cwd: import.meta.dirname, env: { ...process.env, PORT: String(port), NODE_ENV: 'production' }, stdio: ['ignore', 'ignore', 'inherit'] })
  for (let i = 0; i < 100; i++) {
    try { await fetch(`http://127.0.0.1:${port}/health`); return p } catch { await new Promise((r) => setTimeout(r, 100)) }
  }
  p.kill()
  throw new Error(`${name} did not start`)
}

export const stop = async (p) => { p.kill(); await new Promise((r) => p.once('exit', r)) }
