# Changelog

## 0.1.0-alpha.0

First public alpha. The API can still change before 0.1.0; see `docs/SPEC.md` for what is planned.

### Framework
- `route()` with full type inference (`c.params`, `c.query`, `c.body`, `c.user`, `c.resource`);
  every route declares `auth` and `response`, and record routes declare `owner` (404 when it fails)
- `t` schemas: string, id, uuid, email, int, number, bool, enum, array, object, empty, and `t.money`
  (bigint minor units inside, decimal string `"12.50"` on the wire, never a float) with `money`
  helpers that take an explicit rounding mode
- `t.model` with `pick`, `omit`, `partial` and `public`; a `.private()` field in a response is a type
  error and stops the app from starting
- `createApp({ auth, routes, cors })`: strict path and request parsing, auth (bearer or cookie, with
  cross-origin protection for cookies), CORS for listed origins only, rate limits, validation, load and
  owner, response filtering; every unsafe route definition stops the app at startup
- Adapters: `app.fetch` (any fetch runtime), `pangol/bun`, `pangol/node` (node:http, no fetch `Request`)

### CLI
- File-based routing (`src/routes/posts/[id].patch.ts`), `pangol check` (SPEC section 9),
  `pangol routes`, `pangol build` (writes `.pangol/routes.ts`)
- `pangol check --manifest` and `pangol diff main` / `a..b` / two files: security changes sorted by
  risk, Markdown for PR comments, `--fail-on high`
- `node --import pangol/register` to run a TypeScript app on Node 22.18+

### Not yet
`pangol dev` / `serve` / `openapi`, `npm create pangol`, the typed client, `t.multipart`, Standard
Schema, multi-core benchmarks.
