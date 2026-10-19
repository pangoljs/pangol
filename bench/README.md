# Benchmark: pangol vs Hono and Elysia (SPEC section 14)

One core per server, the same API in each framework, every server passing the same conformance
check (`conform.mjs`, 16 cases: statuses, filtered output, owner 404, mass assignment, no leaked
`passwordHash`) before it is measured.

| Scenario | What runs |
|---|---|
| `GET /health` | framework overhead |
| `GET /users/:id` | bearer auth + permission + param validation + load + owner rule + response filtering |
| `POST /users` | bearer auth + permission + content-type + JSON parse + body validation + filtering |

## Results (2026-10-19)

Requests/s, median of 5 alternating rounds × 8 s (3 s warm-up each). p99 in ms, RSS after the run.

| Server | `/health` | `GET /users/:id` | `POST /users` | p99 GET | RSS |
|---|---:|---:|---:|---:|---:|
| **pangol (Bun)** | **165,918** | **132,069** | **103,052** | 0.85 | 61 MB |
| Elysia (Bun) | 217,151 | 163,039 | 106,193 | 0.72 | 66 MB |
| Hono (Bun) | 146,352 | 115,611 | 102,349 | 0.87 | 65 MB |
| bare `Bun.serve` | 207,017 | – | – | – | 44 MB |
| **pangol (Node)** | **105,279** | **90,582** | **69,741** | 1.15 | 98 MB |
| Hono (Node) | 104,930 | 86,907 | 68,506 | 1.76 | 101 MB |
| bare `node:http` | 111,327 | – | – | – | 94 MB |

Every run is in [`results.json`](results.json) (`runs`); rounds varied by about ±2%.

## Against the SPEC targets

| Target | Result | |
|---|---|---|
| `/health` ≥ 90% of the bare server | Node 95% · Bun 80% | Node ✓ · Bun ✗ |
| GET ≥ Elysia (Bun) | 81% of Elysia | ✗ |
| GET ≥ 1.3× Hono (Node) | 1.04× | ✗ (see below) |
| POST ≥ Elysia (Bun) | 97% of Elysia | ✗, close |
| p99 ≤ Hono | GET: Bun 0.85 vs 0.87, Node 1.15 vs 1.76 | ✓ |
| RAM ≤ Hono | Bun 61 vs 65 MB, Node 98 vs 101 MB | ✓ |

What the numbers do not show on their own:

- **pangol sends three security headers on every response** (`x-content-type-options`,
  `x-frame-options`, `cache-control: no-store`); Hono and Elysia here send none. Bare Bun with the same
  four headers drops from 207k to 190k req/s. Elysia with the same headers did about 185k on
  `/health` and 147k on GET in a single check run, which puts pangol's GET at about 90% of Elysia doing
  the same work.
- **pangol reads the raw URL on every request** for the strict path check (SPEC section 8: `%2F`,
  dot-segments, non-canonical encodings are refused). On Bun that string alone costs about 10% of
  `/health`; Elysia routes through Bun's native router and never reads it.
- **Elysia caches the response of a constant handler**, so its `/health` beats bare `Bun.serve`.
- **Hono uses hand-written validation here**, its fastest case. The PoC used `@hono/zod-validator`,
  which is slower; that is where the "1.3× Hono" target came from. Against idiomatic Hono the Node
  numbers would look better than they do here.
- Single core, in-memory data, no database: with real I/O the differences between frameworks shrink.

## Found by this benchmark (fixed before the run above)

- The Node adapter closed every keep-alive connection (`req.complete` is false while a synchronous
  route answers): 25k → 105k req/s on `/health`.
- A per-request object literal with a getter made V8 pretenure and deoptimize in a loop, with a
  full GC every ~110 ms: 0.62 → 0.17 µs per `handle()` call.
- The fetch adapter read bodies through a stream reader; on Bun that was 5× slower than reading a
  body with a declared length in one call: POST on Bun 20k → 103k req/s.

## Environment

Intel i7-13700 (server on CPU 2, wrk on CPU 4: different physical P-cores), Linux 7.0, Bun 1.3.13,
Node 22.23.1, wrk 4.2.0 (`-t1 -c64`), Hono 4.13.13, @hono/node-server 2.1.5, Elysia 1.4.30.

## Run it

```sh
pnpm --dir .. build                      # pangol is linked from ../packages/pangol
pnpm install --ignore-workspace          # Hono and Elysia live here only, not in the workspace
node conform.mjs                         # every server must pass before it is measured
WRK=/path/to/wrk node bench.mjs          # needs wrk and taskset; about 20 minutes
```

`SERVER_CPU`, `WRK_CPU`, `ROUNDS`, `DURATION` and `WARMUP` override the defaults (2, 4, 5, 8s, 3s).
