# pangol

Alpha: the API can still change before 0.1.0. See the [repository README](../../README.md),
[docs/SPEC.md](../../docs/SPEC.md) and the [changelog](CHANGELOG.md).

```sh
npm install pangol@alpha
npm install -D typescript    # for the pangol CLI (check, diff); the framework itself has no dependencies
```

Node 22+ (22.18+ to run `.ts` files directly) or Bun.

## What works today

- `route()` and `t` with full type inference (`c.params`, `c.query`, `c.body`, `c.user`, `c.resource`)
- `createApp({ auth, routes })`: the request pipeline of SPEC section 3 —
  strict path check, routing (404/405), CORS for listed origins, auth (401/403, cookie CSRF protection), rate limit (429),
  validation (400/413/415), `load` + `owner` (404), handler, response filtering (500 on mismatch)
- Adapters: `app.fetch(request)` for any fetch runtime, `serve(app)` from `pangol/bun`, and
  `serve(app)` / `createServer(app)` from `pangol/node` (node:http, no fetch `Request`, raw request-target checks).
  A conformance test sends the same requests through each and compares the answers.
- `t.money` (bigint minor units inside, decimal string `"12.50"` on the wire, never a float) and
  the `money` helpers with explicit rounding; `t.email`, `t.uuid`
- `t.model` with `pick`, `omit`, `partial` and `public`; a `.private()` field in a response is a
  type error and stops the app from starting
- Startup checks: an app with an unsafe or invalid route (missing `owner` on a record route,
  `params` not matching the path, body on GET, unknown option…) refuses to start

- File-based routing and the `pangol` CLI: `pangol check` (every rule of SPEC section 9 that
  applies today, with the file and a fix), `pangol routes`, `pangol build` (writes `.pangol/routes.ts`).
  `node --import pangol/register` runs a TypeScript app on Node 22.18+; Bun runs it as is.

- The security manifest (`pangol check --manifest m.json`) and `pangol diff main` (or `a..b`, or two
  manifest files): changes sorted 🔴/🟡/✓/ℹ, `--format markdown` for a PR comment, `--fail-on high`.

Not yet: `pangol dev`/`serve`/`openapi`, `npm create pangol`, `t.multipart`, the typed client.

## Project layout

```
src/
  auth.ts                  export default defineAuth({ from, resolve })
  models.ts                t.model(...) shared by routes
  routes/
    health.get.ts          GET  /health     export default route({...})
    posts/index.post.ts    POST /posts
    posts/[id].patch.ts    PATCH /posts/:id
    posts/_helpers.ts      not a route (starts with _)
  server.ts                createApp({ auth, routes }) with routes from .pangol/routes.js
```

```sh
npx pangol check     # rules of SPEC section 9, exit 1 with a fix for each problem
npx pangol build     # check, then write .pangol/routes.ts (add .pangol/ to .gitignore)
npx pangol diff main --format markdown --fail-on high   # security changes of this branch
bun src/server.ts    # or: node --import pangol/register src/server.ts
```

## Example (one file)

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

const Post = t.model({
  id: t.id(),
  title: t.string({ max: 200 }),
  authorId: t.id(),
  internalNotes: t.string().private(), // can never be in a response
})

const app = createApp({
  auth,
  routes: {
    'GET /posts/:id': route({
      auth: 'user',
      params: t.object({ id: t.id() }),
      load: (c) => db.posts.get(c.params.id),
      owner: (c, post) => post.authorId === c.user.id, // not the owner -> 404
      response: Post.public(), // fields outside the schema never leave the server
      handler: (c) => c.resource,
    }),
  },
})

serve(app, { port: 3000 })
```

Checks: `pnpm typecheck`, `pnpm test`, `pnpm test:bun`, `pnpm build`.
