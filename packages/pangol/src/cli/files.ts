// File-based routing (SPEC section 4): one file is one route, and its path says the method and URL.
//   posts/[id].patch.ts -> PATCH /posts/:id     posts/index.get.ts -> GET /posts
// Files and folders starting with "_" are not routes; any other name that does not fit is an error.

export type FileRoute =
  | { readonly kind: 'route'; readonly key: string }
  | { readonly kind: 'skip' }
  | { readonly kind: 'error'; readonly what: string; readonly fix: string }

const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete'])
const EXTENSION = /\.(?:ts|mts|js|mjs)$/
const PARAM = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/
// Unreserved URL characters only (RFC 3986), so the path needs no encoding and passes the strict check.
const LITERAL = /^[A-Za-z0-9_~-][A-Za-z0-9._~-]*$/
const NAMING = 'name route files <name>.<method>.ts with method get, post, put, patch or delete, e.g. posts/[id].patch.ts; start helpers with _'

/** `file` is relative to the routes folder, with "/" separators. */
export function routeFromFile(file: string): FileRoute {
  const parts = file.split('/')
  if (parts.some((p) => p.startsWith('_')) || file.endsWith('.d.ts')) return { kind: 'skip' }
  const error = (what: string, fix = NAMING): FileRoute => ({ kind: 'error', what, fix })
  const base = parts.pop() ?? ''
  if (!EXTENSION.test(base)) return error('is not a route file')
  const pieces = base.replace(EXTENSION, '').split('.')
  if (pieces.length !== 2) return error('does not look like <name>.<method>.ts')
  const [name = '', method = ''] = pieces
  if (!METHODS.has(method)) return error(`"${method}" is not a method`)
  const segments = [...parts, ...(name === 'index' ? [] : [name])]
  const path: string[] = []
  const params = new Set<string>()
  for (const segment of segments) {
    const param = PARAM.exec(segment)
    if (param !== null) {
      const id = param[1] as string
      if (params.has(id)) return error(`uses the param [${id}] twice`, 'give each param in the path its own name, e.g. [postId]/comments/[id]')
      params.add(id)
      path.push(':' + id)
    } else if (LITERAL.test(segment)) {
      path.push(segment)
    } else {
      return error(`"${segment}" is not a valid path segment`, 'use letters, digits, "-", "_", "~" and "." (not first), or a param like [id] with a name that is a valid identifier')
    }
  }
  return { kind: 'route', key: `${method.toUpperCase()} /${path.join('/')}` }
}
