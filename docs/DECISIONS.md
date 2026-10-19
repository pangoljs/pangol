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

## Open

- Idempotency: core (`idempotent: true` on `route()`) or plugin? Where are keys stored, and for how long?
- Allow switching owner failure to 403 per route?
- Domain (pangol.dev?) and trademark check.
