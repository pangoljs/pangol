<p align="center">
  <img src="docs/brand/pangol-logo.svg" alt="pangol" width="420">
</p>

<p align="center">
  <b>The TypeScript backend framework you can let AI write.</b><br>
  Common vulnerabilities become build errors. Every risky change shows up in the PR.
</p>

> **Status: pre-alpha.** Nothing is published yet. This repository currently holds the
> [specification](docs/SPEC.md) and the [proof-of-concept experiments](poc/) that shaped it.
> Work on v0.1 happens in [`packages/pangol`](packages/pangol).

## Why

- **Secure by construction.** Every route declares `auth`, its input schema and its `response`. Routes with
  `[id]` must declare `owner`. Missing any of these is a build error, not a code-review comment.
- **Reviewable in seconds.** `pangol diff main..HEAD` summarises what a PR changed about security
  (auth weakened, owner rule changed, new response field that looks secret, mass-assignment fields…).
- **Fast.** Routes compile ahead of time into straight-line functions. No middleware chain.
- **Runs anywhere.** Node, Bun, and any `fetch` runtime. Mount into an existing Next.js / Hono / Express app,
  and eject to plain Hono if you ever leave.
- **Less schema to write.** `t.model` once, then `pick` / `omit` / `public()` per route. Pull models from
  your database (v0.2) or generate migrations from them (v0.3).

```ts
// src/routes/posts/[id].patch.ts
import { route, t } from 'pangol'
import { Post } from '../../models'

export default route({
  auth: 'user',
  params: t.object({ id: t.id() }),
  load: (c) => db.posts.get(c.params.id),
  owner: (c, post) => post.authorId === c.user.id,
  body: Post.pick('title', 'body').partial(),
  response: Post.public(),
  handler: (c) => db.posts.update(c.resource.id, c.body),
})
```

## Repository layout

| Path | What |
|---|---|
| [`docs/SPEC.md`](docs/SPEC.md) | Technical specification v0.1 (Thai) |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Decisions made and still open |
| [`poc/`](poc/) | Five proof-of-concept experiments with results and honest limitations |
| [`packages/pangol`](packages/pangol) | The framework (v0.1, in progress) |
| [`docs/brand/`](docs/brand/) | Logo and mascot assets |

## Proof-of-concept results (short)

| PoC | Question | Result |
|---|---|---|
| [rpc](poc/rpc) | Typed client without slowing the IDE? | At 2,000 routes: route autocomplete 0.53 s vs 49.8 s for Hono RPC (~94×) |
| [runtime](poc/runtime) | Close to Go without being tied to Bun? | 1 core: `GET /users/:id` 44k req/s on Bun (Hono 22k, Elysia 41k, Go net/http 28k); Node 1.4× Hono. Multi-core not measured yet |
| [strict](poc/strict) | Can strict parsing close known framework CVEs cheaply? | 13/13 CVE regression tests, ~24M fuzz inputs; overhead within noise on Node, up to 5.1% on Bun |
| [ai](poc/ai) | Can AI learn it from one page of docs? | 3 Claude models, 100% of hidden tests; 1.4–3.3× less code than Hono. Security vs Hono: only a small difference |
| [review](poc/review) | Does the security diff catch vulnerable PRs? | 24/26 simulated vulnerable PRs blocked or flagged, 0 false 🔴 — but the rules were tuned on this set; a fresh held-out set is still needed |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
