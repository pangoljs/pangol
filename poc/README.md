# Proof-of-concept experiments

These five experiments were run before writing the spec. They are kept as evidence and
reference code, **not** as the framework. They use the old working name **hyperflat**
(including the `HYPERFLAT.md` doc given to AI agents in `ai/` and `review/`).

Each folder has its own README with method, results and limitations (in Thai).
`node_modules` and build outputs were removed; run `npm install` inside a folder to rerun it.

| Folder | Question | Notes |
|---|---|---|
| [rpc](rpc) | Codegen'd flat types vs Hono RPC inference at 2,000 routes | |
| [runtime](runtime) | Compiled pipeline vs Hono, Elysia, Go on Node and Bun | Go server: `cd runtime/servers/go && go build -o server` |
| [strict](strict) | Strict parsers, 13 CVE regressions, property fuzzing | |
| [ai](ai) | Can AI agents learn the framework from one doc page? Security vs Hono | `runs/` holds the agents' code |
| [review](review) | `owner` rule + security manifest diff on 36 simulated PRs | `eval/run-suite.mjs` |

Honest caveats that carry into v0.1 are listed in `docs/SPEC.md` section 18.
