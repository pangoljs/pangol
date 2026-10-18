# Contributing

## Setup

```bash
corepack enable
pnpm install
pnpm test
pnpm typecheck
```

Node 20+ is required. Bun is optional (used for the Bun adapter tests).

## Rules

- **Spec first.** Behaviour changes start as a change to `docs/SPEC.md` (or an entry in `docs/DECISIONS.md`).
- **Security rules need two tests:** one case that must be caught and one safe case that must stay quiet.
  This is how the PoC kept false alarms at zero (see `poc/review`).
- **Every security fix ships with a regression test** in `packages/pangol/test/security/`.
- **Every code example in the docs must pass `pangol check`** in CI.
- **No new runtime dependencies** in `packages/pangol` without discussion. The core aims for zero.
- Commit messages: [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `docs:` …).

## Working with AI coding tools

Read [AGENTS.md](AGENTS.md). It is the same brief the AI tools get.
