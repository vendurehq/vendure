# Bootstrap benchmark harness

Measures cold-start time of the Vendure server & worker using the built JS output
(`packages/core/dist`), the way production runs it.

## Setup (once)

```bash
bun install
cd packages/common && bun run build && cd ../core && bun run build
node scripts/bootstrap-bench/populate-db.js      # creates bench.sqlite with mock data
node scripts/bootstrap-bench/setup-heavy-db.js   # creates bench-heavy.sqlite (synthetic plugin tables)
```

## Running

```bash
node scripts/bootstrap-bench/bench.js <target> [--runs=7] [--cpu-prof]
```

Targets: `server`, `worker`, `phases` and heavy variants `server-heavy`,
`worker-heavy`, `phases-heavy` (adds 20 synthetic plugins with entities, admin/shop
API extensions, custom fields, job-queue creation (30 queues), event-bus
subscriptions and DB-querying lifecycle hooks, modeled on a survey of two real
production codebases — see `heavy-plugins.js`). Heavy server-total baseline after
the queue/subscription upgrade: ~905ms median (bootstrap phase ~550ms).

- `phases` mirrors `bootstrap()` step-by-step (keep in sync with `packages/core/src/bootstrap.ts`).
- `--cpu-prof` writes .cpuprofile files to `profiles/`; analyze with
  `node analyze-profile.js <file> [--files] [--top=N]`.
- Per-package require cost: `node -r ./scripts/bootstrap-bench/require-times.js scripts/bootstrap-bench/server-entry.js`
- `BENCH_PORT=<port>` overrides the API port (default 4999) — needed for parallel runs.

## Baseline (2026-08-24, M-series mac, node 24.14.1, medians of 7 runs)

| phase                | server | server-heavy | worker |
|----------------------|--------|--------------|--------|
| startup (node init)  | 12     | 11           | 13     |
| require @vendure/core| 333–425| 314          | 395    |
| preBootstrapConfig   | 3      | 6            | —      |
| require app.module   | 48     | 50           | —      |
| NestFactory.create   | 248–270| 353          | —      |
| app.init (hooks)     | 103    | 113          | —      |
| bootstrap() total    | 397–444| 502          | 81     |
| **process total**    | **746–878** | **826** | **480** |

Run-to-run noise is ±10%; always compare medians of ≥7 runs captured in the same
session, and re-capture the baseline alongside any candidate change.

Key attribution (from `--cpu-prof` + require-times):
- ~50% of profile is `(program)` = V8 parse/compile of ~3390 modules at require time.
- Top require costs: core dist 206ms/664 modules, @graphql-tools/utils 114ms/607(!),
  typeorm 104ms/353, @nestjs/common 52ms, @nestjs/graphql 48ms, rxjs 42ms, @nestjs/core 41ms, graphql 34ms.
- `NODE_COMPILE_CACHE=/tmp/x` (warm) cuts total ~15% (843→715ms median).
