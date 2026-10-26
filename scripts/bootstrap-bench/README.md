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

## Simulating small cloud instances

Two options, in increasing fidelity:

1. Efficiency cores (instant, native, noisy — magnitude only):
   `taskpolicy -c background node scripts/bootstrap-bench/bench.js server --runs=7`
2. Docker with cgroup limits (recommended). The compiled dist is platform-independent,
   so only node_modules needs a Linux install:
   ```bash
   docker volume create vendure-bench
   # copy repo (sans node_modules/.git) into the volume, then Linux install:
   docker run --rm -v "$PWD":/src:ro -v vendure-bench:/work oven/bun:1 bash -c \
     "mkdir -p /work/repo && cd /src && tar cf - --exclude=node_modules --exclude=.git . | tar xf - -C /work/repo && cd /work/repo && bun install"
   # better-sqlite3 needs the node toolchain to build:
   docker run --rm -v vendure-bench:/work node:24 bash -c \
     "cd /work/repo/node_modules/better-sqlite3 && npm run install"
   docker run --rm -v vendure-bench:/work node:24 bash -c \
     "cd /work/repo && rm -f scripts/bootstrap-bench/bench.sqlite && node scripts/bootstrap-bench/populate-db.js"
   # benchmark under constraint:
   docker run --rm --cpus=1 --memory=2g --memory-swap=2g -v vendure-bench:/work node:24 bash -c \
     "cd /work/repo && node scripts/bootstrap-bench/bench.js server --runs=7"
   ```
   For A/B runs, swap `packages/core/dist` variants back-to-back INSIDE one container
   run — cross-container comparisons are polluted by VM page-cache state.
   Note the constrained core is still an M4-class core; real cloud vCPUs are
   typically 1.5-3x slower per core, so scale expectations accordingly.

## Results of the optimization pass (2026-08-24, medians, quiet machine, 9-11 runs)

A/B of this branch's perf commits vs their merge-base, identical harness. Server
totals include a full GET /health round-trip after bootstrap.

| target | baseline | optimized | + warm NODE_COMPILE_CACHE |
|---|---|---|---|
| server total          | 744ms | 679ms (-8.7%)  | 657ms (-11.7%) |
| worker total          | 414ms | 314ms (-24.3%) | 300ms (-27.6%) |
| server-heavy total    | 871ms | 729ms (-16.3%) | 647ms (-25.7%) |
| server-heavy bootstrap phase | 521ms | 418ms (-19.8%) | — |
| require @vendure/core (server) | 333ms | 244ms (-26.8%) | ~207-226ms |

See FINDINGS.md for the full write-up.

## Original baseline (2026-08-24, M-series mac, node 24.14.1, medians of 7 runs)

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
