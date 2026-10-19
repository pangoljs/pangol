// Route table. Static paths are a Map lookup; param routes are grouped by segment count.
// A literal segment beats a param (SPEC section 4), and an earlier literal beats a later one.

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

interface Pattern<R> {
  readonly segments: readonly (string | null)[] // null = param
  readonly methods: Map<string, R>
}

export type Found<R> =
  | { readonly route: R; readonly values: readonly string[] }
  | { readonly allow: string }
  | null

export class Router<R> {
  private readonly statics = new Map<string, Map<string, R>>()
  private readonly patterns = new Map<number, Pattern<R>[]>()

  /** Returns false when the method and path shape are already taken. */
  add(method: Method, path: string, route: R): boolean {
    const segments = path.split('/').slice(1).map((s) => (s.startsWith(':') ? null : s))
    let methods: Map<string, R> | undefined
    if (!segments.includes(null)) {
      methods = this.statics.get(path)
      if (methods === undefined) this.statics.set(path, methods = new Map())
    } else {
      const list = this.patterns.get(segments.length) ?? []
      this.patterns.set(segments.length, list)
      methods = list.find((p) => p.segments.every((s, i) => s === segments[i]))?.methods
      if (methods === undefined) list.push({ segments, methods: methods = new Map() })
    }
    if (methods.has(method)) return false
    methods.set(method, route)
    return true
  }

  find(method: string, path: string): Found<R> {
    const exact = this.statics.get(path)
    if (exact !== undefined) return pick(exact, method, [])
    const parts = path.split('/').slice(1)
    let best: Pattern<R> | undefined
    let bestScore = -1
    for (const p of this.patterns.get(parts.length) ?? []) {
      let score = 0
      let ok = true
      for (let i = 0; i < parts.length; i++) {
        const s = p.segments[i]
        if (s === null) continue
        if (s !== parts[i]) { ok = false; break }
        score += 2 ** (parts.length - i)
      }
      if (ok && score > bestScore) { best = p; bestScore = score }
    }
    if (best === undefined) return null
    const segments = best.segments
    return pick(best.methods, method, parts.filter((_, i) => segments[i] === null))
  }
}

function pick<R>(methods: Map<string, R>, method: string, values: readonly string[]): Found<R> {
  const route = methods.get(method)
  return route !== undefined ? { route, values } : { allow: [...methods.keys()].join(', ') }
}
