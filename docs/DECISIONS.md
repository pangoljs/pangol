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

## Open

- Idempotency: core (`idempotent: true` on `route()`) or plugin? Where are keys stored, and for how long?
- `t.money` JSON wire format: decimal string (`"12.50"`) or integer minor units (`1250`) by default?
- Allow switching owner failure to 403 per route?
- Domain (pangol.dev?) and trademark check.
