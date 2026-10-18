# Security policy

pangol is pre-alpha and has no supported release yet. Even so, please report
security problems privately.

## Reporting

Use GitHub's **private vulnerability reporting** (Security tab → "Report a vulnerability").
Please do not open a public issue for a security problem.

Include: affected version or commit, a minimal reproduction, and the impact you expect.
We aim to acknowledge reports within 3 working days.

## Scope

In scope: the request pipeline (path, routing, auth, validation, load/owner, serialization),
parsers, build check, manifest/diff rules, the typed client and the CLI.

Every confirmed issue gets a regression test in `packages/pangol/test/security/`
before the fix is released, in the same way the PoC kept a test per known CVE
(`poc/strict/tests/cve.test.mjs`).
