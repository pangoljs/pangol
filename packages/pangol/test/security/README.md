One regression test per security issue or known framework CVE.

| File | Covers |
|---|---|
| `cve.test.ts` | Hono, Fastify and Elysia CVEs and classic attacks, ported from `poc/strict/tests/cve.test.mjs` |
| `fuzz.test.ts` | Property-based fuzzing of the strict parser (fast-check). `FUZZ_RUNS` scales it: 20k per PR, 24 million nightly (SPEC section 15) |
| `strict-parser.test.ts` | Gaps found when auditing the PoC parser before porting it |
| `schema-declarations.test.ts` | Schema limits, defaults and patterns that could weaken validation |

A security fix adds its test here before the fix is released (see SECURITY.md).
