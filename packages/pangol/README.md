# pangol

Pre-alpha: nothing is published and the API can still change. See the
[repository README](../../README.md) and [docs/SPEC.md](../../docs/SPEC.md).

## What works today

- `route()` and `t` with full type inference (`c.params`, `c.query`, `c.body`, `c.user`, `c.resource`)
- `createApp({ auth, routes })`: the request pipeline of SPEC section 3 —
  strict path check, routing (404/405), auth (401/403, cookie CSRF protection), rate limit (429),
  validation (400/413/415), `load` + `owner` (404), handler, response filtering (500 on mismatch)
- Adapters: `app.fetch(request)` for any fetch runtime, `serve(app)` from `pangol/bun`, and
  `serve(app)` / `createServer(app)` from `pangol/node` (node:http, no fetch `Request`, raw request-target checks).
  A conformance test sends the same requests through each and compares the answers.
- `t.money` (bigint minor units inside, decimal string `"12.50"` on the wire, never a float) and
  the `money` helpers with explicit rounding; `t.email`, `t.uuid`
- Startup checks: an app with an unsafe or invalid route (missing `owner` on a record route,
  `params` not matching the path, body on GET, unknown option…) refuses to start

Not yet: file-based routing and the `pangol` CLI (`check`, `diff`, `build`),
CORS headers, `t.model`, `t.multipart`, the typed client and OpenAPI.

## Example

```ts
import { createApp, defineAuth, route, t } from 'pangol'
import { serve } from 'pangol/bun'

export const auth = defineAuth({
  from: 'bearer', // or { cookie: 'session' }
  resolve: async (req) => db.sessions.user(req.credential), // { id, permissions, ... } or null
})
declare module 'pangol' {
  interface Register { auth: typeof auth }
}

const Post = t.object({ id: t.id(), title: t.string({ max: 200 }) })

const app = createApp({
  auth,
  routes: {
    'GET /posts/:id': route({
      auth: 'user',
      params: t.object({ id: t.id() }),
      load: (c) => db.posts.get(c.params.id),
      owner: (c, post) => post.authorId === c.user.id, // not the owner -> 404
      response: Post, // fields outside the schema never leave the server
      handler: (c) => c.resource,
    }),
  },
})

serve(app, { port: 3000 })
```

Checks: `pnpm typecheck`, `pnpm test`, `pnpm test:bun`, `pnpm build`.
