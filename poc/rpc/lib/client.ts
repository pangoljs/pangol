// RPC client. No Proxy: the path is a plain string key, and its types are a flat
// lookup into the generated Api interface (no inference over the server app).

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type Base = { headers?: Record<string, string>; signal?: AbortSignal }
type Pick_<A, K extends string> = K extends keyof A ? A[K] : {}
type Output<R> = R extends { output: infer O } ? O : never
type Args<R> = R extends { input: infer I } ? (I extends void ? [opts?: Base] : [opts: I & Base]) : never
type Call<T> = <P extends keyof T & string>(path: P, ...args: Args<T[P]>) => Promise<Output<T[P]>>

export interface Client<A> {
  get: Call<Pick_<A, 'GET'>>
  post: Call<Pick_<A, 'POST'>>
  put: Call<Pick_<A, 'PUT'>>
  patch: Call<Pick_<A, 'PATCH'>>
  delete: Call<Pick_<A, 'DELETE'>>
}

export class ApiError extends Error {
  constructor(readonly status: number, readonly body: unknown) {
    super(`HTTP ${status}`)
  }
}

export interface ClientConfig {
  baseUrl: string
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  fetch?: typeof fetch
}

type Opts = Base & { params?: Record<string, string>; query?: Record<string, unknown>; body?: unknown }

export function createClient<A>(cfg: ClientConfig): Client<A> {
  const f = cfg.fetch ?? fetch
  const call = (method: Method) => async (path: string, opts: Opts = {}) => {
    let url = cfg.baseUrl + path.replace(/:(\w+)/g, (_, k: string) => {
      const v = opts.params?.[k]
      if (v === undefined) throw new Error(`missing path param "${k}" for ${path}`)
      return encodeURIComponent(v)
    })
    if (opts.query) {
      const qs = new URLSearchParams()
      for (const [k, v] of Object.entries(opts.query)) if (v !== undefined) qs.set(k, String(v))
      const s = qs.toString()
      if (s) url += '?' + s
    }
    const headers: Record<string, string> = { ...(await cfg.headers?.()), ...opts.headers }
    let body: string | undefined
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json'
      body = JSON.stringify(opts.body)
    }
    const res = await f(url, { method, headers, body, signal: opts.signal })
    const data = res.status === 204 ? undefined : await res.json()
    if (!res.ok) throw new ApiError(res.status, data)
    return data
  }
  return { get: call('GET'), post: call('POST'), put: call('PUT'), patch: call('PATCH'), delete: call('DELETE') } as Client<A>
}
