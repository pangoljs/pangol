# pangol

Pre-alpha. Not usable yet. See the [repository README](../../README.md) and [docs/SPEC.md](../../docs/SPEC.md).

v0.1 starts with Bun. This first slice exports schema and route **declarations**,
not an HTTP server: validators, response serializers, ownership enforcement,
compiler checks and adapters are still to come. Do not invoke a declared handler
as a request endpoint.

Implemented schema metadata: `t.string`, `t.id`, `t.int`, `t.number`, `t.bool`,
`t.enum`, `t.array`, `t.object`, `t.empty`, `.optional()` and `.default()`.
`route()` infers inputs, awaited non-null resources from `load`, and response types.
`t.model` and `t.money` are not implemented yet; the money wire format remains open.

For custom auth fields, register the resolver's type once in the application:

```ts
import { defineAuth, route, t } from 'pangol'

export const auth = defineAuth({
  resolve: async (_request: Request) => ({ id: 'u1', permissions: ['read'], name: 'Ada' }),
})

declare module 'pangol' {
  interface Register { auth: typeof auth }
}

export default route({
  auth: 'user',
  response: t.object({ name: t.string() }),
  handler: (c) => ({ name: c.user.name }),
})
```

Without registration, authenticated users have `id` and `permissions`. Public
contexts cannot read `user`; optional auth requires a null check. Undeclared body,
query and resource fields are unavailable to handlers. Filesystem-dependent rules
(such as requiring owner for `[id]` routes) need the future compiler.

Checks: `pnpm typecheck`, `pnpm test`, `pnpm test:bun`, `pnpm build`.
Run `bun dev` from this package (or the repository root) to watch `src/` and rebuild
the library's JavaScript and declarations in `dist/`. Stop with Ctrl+C. This is a
library build watcher; it does not start an HTTP server. The future `pangol dev`
CLI will check routes and start the configured adapter.
The Bun job runs the same Vitest tests under Bun 1.3.13; Node CI also remains enabled.

Run `pnpm --filter pangol typeperf` for a reproducible server type benchmark
(1 and 2,000 independent routes). Initial local baseline on Bun 1.3.13 / TypeScript
5.9.3: 2,000 routes used 1,207,812 instantiations, 532,415 KB and 6.55 s check time
(6.88 s total). These are server declarations, not the generated client or IDE
autocomplete benchmark in SPEC section 14; those targets have not been measured.
