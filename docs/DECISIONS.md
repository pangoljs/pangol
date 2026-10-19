# Decisions

## Decided

| Date | Decision | Why |
|---|---|---|
| 2026-10-14 | Name **pangol** (npm `pangol` + `@pangol`, GitHub org `pangoljs`), mascot: pangolin | Free on npm; "hyperflat" was taken. "Scute" clashed with the Scute auth platform (`@scute/*`) |
| 2026-10-14 | MIT license | Default for JS frameworks; lowest friction for adoption |
| 2026-10-14 | `t.money` in v0.1, no floats for money | The PoC computed prices with floats; fixing later would break user code |
| 2026-10-14 | One source of truth per table: `models.source: 'database' \| 'framework'` | Lets `db pull` (v0.2) and `migrate generate` (v0.3) coexist without conflicts |
| 2026-10-14 | Owner failure → 404 | Do not reveal that a record exists |
| 2026-10-14 | Bun first for v0.1; keep core runtime-neutral | User chose Bun as the first implementation and validation target; Node and fetch adapters follow |
| 2026-10-14 | Wording: "financial-grade ready", not "certified" | Certification depends on the whole system the user builds |
| 2026-10-18 | `t.money` JSON wire format is a **decimal string** (`"12.50"`); inside the server it is integer minor units (bigint) | A JSON number would be read as a float by JS clients and loses precision past 2^53; matches SPEC section 6 |
| 2026-10-18 | `defineAuth({ from, resolve(req) })`: `from` is `'bearer'` or `{ cookie }`; `resolve` gets a read-only `AuthRequest` (method, url, headers, cookies, credential), not a `Request` | The Node adapter never builds a `Request` (SPEC section 3); knowing the credential source lets the framework tell "no credential" from "bad credential" for `'optional'` and turn on CSRF protection for cookies |
| 2026-10-18 | Cookie auth gets cross-origin protection on unsafe methods from `Sec-Fetch-Site` / `Origin` (SPEC section 12), no CSRF tokens | Stateless and needs nothing from the app; same approach as Go's `CrossOriginProtection` |
| 2026-10-18 | Minimum Node.js is **22** (was 20); CI tests 22, 24 and 26 | Node 20 reached end of life on 2026-04-30 and gets no security fixes. Nothing is published yet, so raising the floor breaks no users |
| 2026-10-19 | `t.money` has `min: "0"` unless declared; bounds are decimal strings | A negative transfer amount is a classic way to move money the wrong way; allowing negatives should be a visible choice in the route. String bounds keep floats out of declarations too |
| 2026-10-19 | `money` helpers take a required rounding mode named as in `Intl.NumberFormat` (`halfEven`, `halfExpand`, …); `mul` takes a decimal string factor | No hidden default rounding; the names are a web standard; a float factor would bring back the error `t.money` removes |
| 2026-10-19 | `t.uuid()` accepts lowercase only; `t.email()` follows the WHATWG `<input type="email">` rule and is not lowercased | One spelling per id (no "A…" vs "a…" duplicates); parsers reject instead of normalizing (SPEC section 8) |
| 2026-10-19 | `.private()` is checked on responses only (type error + startup check); input may contain private fields. `Model.public()` drops any field that is or contains a private field; `partial()` drops defaults | A body may legitimately carry a secret (a password); a response never may. Dropping the containing field keeps the runtime and the type in agreement. A PATCH default would overwrite stored data |
| 2026-10-19 | CORS: exact origins only (no `*`, checked at startup); `Allow-Credentials` follows the auth (cookie = on, bearer = off) instead of an option; preflight from an unlisted origin = 403 | A wildcard or a loose match (suffix, case) is the usual CORS hole; tying credentials to the credential source removes a setting that can only be wrong; a 403 shows up in the network tab where a bare 204 would not |
| 2026-10-19 | `pangol check` loads the real route files and reuses createApp's startup checks; AST rules read `Function.prototype.toString()` of the loaded handler with the TypeScript parser. `typescript` is an optional peer dependency used only by the CLI | One checker for check and startup means they can never disagree; reading the loaded function covers routes built by helpers; the core keeps zero runtime dependencies |
| 2026-10-19 | File routing produces a generated static table, `.pangol/routes.ts` (`pangol build`), passed to `createApp({ routes })`; no file system scan at run time | Works on every runtime and bundler, keeps startup cheap, and the table is visible code |
| 2026-10-19 | `pangol/register` for running TypeScript on Node 22.18+ (type stripping + a `.js`→`.ts` resolve hook), no loader dependency | Node already strips types; only the `./x.js` import habit of TypeScript was missing |
| 2026-10-19 | `pangol diff <ref>` rebuilds the base manifest in a temporary git worktree that reuses the installed `node_modules`; `--fail-on` takes `high` or `medium` (the SPEC's `check` level was replaced: `pangol check` already fails on its own) | A committed manifest can be edited by the same PR; a level name is clearer than overloading `check` |

| 2026-10-19 | `create-pangol` versions independently; the template pins the tested `pangol` version | User chose independent releases; generator fixes need not release the framework |
| 2026-10-19 | OpenAPI: 201 is read from the handler's AST (`c.created`), no `status` option on `route()`; input schemas leave `additionalProperties` open (undeclared input is dropped, not refused); what JSON Schema cannot express goes into `x-pangol-*` extensions | Keeps `route()` unchanged and the document truthful: a client reading it must not believe the server refuses what it accepts, or accepts what it refuses |

| 2026-10-19 | Defer pangol + HTMX / HTML responses to the final future-work section of SPEC; prioritize backend readiness first | User requested recording the direction now, without implementing a frontend layer or choosing its API |

## Open

- Idempotency: core (`idempotent: true` on `route()`) or plugin? Where are keys stored, and for how long?
- Allow switching owner failure to 403 per route?
- Domain (pangol.dev?) and trademark check.
