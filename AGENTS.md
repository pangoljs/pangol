# AGENTS.md — brief for AI coding agents working on this repo

pangol is a TypeScript backend framework. Its promise: common vulnerabilities become
build errors, and every risky change shows up in the PR. Read `docs/SPEC.md` before changing behaviour.

## Repo map

- `packages/pangol/` — the framework (v0.1 in progress). Source in `src/`, tests in `test/`.
- `docs/SPEC.md` — the specification. Source of truth for behaviour.
- `docs/DECISIONS.md` — decided and open questions. Do not silently decide an open one; ask.
- `poc/` — finished experiments. **Read-only reference.** They use the old working name
  "hyperflat"; do not rename inside `poc/`.

## Commands

- `pnpm install`, `pnpm test`, `pnpm typecheck`

## Non-negotiables

1. Every route must declare `auth`, its input schemas and `response`. Never add a code path that
   skips validation or response filtering.
2. Owner check failures return **404, not 403** (do not leak that a record exists).
3. Parsers reject anything ambiguous (see SPEC section 8). Prefer a 400 over a guess.
4. Never use floating point for money. Use `t.money` (integer minor units / decimal string).
5. The core package has no runtime dependencies.
6. A new security rule needs a positive and a negative test. A security fix needs a regression test.
7. Don't weaken a test to make it pass. If a test looks wrong, say so.

## Style

- TypeScript strict mode, ESM only, Node 20+.
- Small pure functions; the hot path (per request) avoids allocation and `async` where it can
  (PoC 2: sync routes without a body were ~30% faster).
