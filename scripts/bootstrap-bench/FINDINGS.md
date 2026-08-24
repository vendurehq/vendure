# Bootstrap-time optimization: findings & results

Date: 2026-08-24. Environment: M-series mac, node 24.14.1, better-sqlite3, built JS
(`packages/core/dist`). All figures are medians; server totals include a full
GET /health round-trip after bootstrap resolves.

## Results

| target | baseline | optimized | + warm NODE_COMPILE_CACHE |
|---|---|---|---|
| server total          | 744ms | 679ms (-8.7%)  | 657ms (-11.7%) |
| worker total          | 414ms | 314ms (-24.3%) | 300ms (-27.6%) |
| server-heavy total¹   | 871ms | 729ms (-16.3%) | 647ms (-25.7%) |
| server-heavy bootstrap phase | 521ms | 418ms (-19.8%) | — |

¹ "heavy" = 20 synthetic plugins modeled on a survey of two production codebases
(two real-world production Vendure codebases): entities, admin+shop API extensions, custom
fields, 30 job queues, 20 event-bus subscriptions, strategy-init fan-outs, DB
queries in lifecycle hooks. The schema-build fixes scale with plugin count, so
real ~50-plugin deployments should see gains at least in the heavy row's range.

## Where the time goes (baseline attribution)

Roughly two-thirds of bootstrap was loading and compiling JavaScript, not running
Vendure logic: ~3,390 modules required before the first line of app code, then
NestJS DI construction, TypeORM metadata, and GraphQL schema building. The
GraphQL schema build (done twice: shop + admin) consumed 55-62% of the whole
`NestFactory.create()` window. TypeORM metadata (~13-27ms) and Nest DI (~11-19ms)
were measured and found NOT worth attacking.

## Changes landed on this branch (no public API changes)

1. **`perf(core): batch plugin api extensions into single extendSchema pass`**
   Each plugin's API extension used to trigger a full-schema rebuild (O(P) passes,
   each walking the whole accumulated type map). Now all plugin documents are
   merged with `concatAST` and applied in one `extendSchema` call. Saving grows
   with plugin count (~60-90ms at 20 plugins).

2. **`perf(core): replace stitchSchemas calls with single-pass type merging`**
   Four generator functions (list options, auth types, permissions enum, active
   order types) used `stitchSchemas` — multi-schema federation machinery with
   proxying wrapper schemas — just to add/replace a handful of named types.
   Replaced with a single `rewireTypes` pass (`merge-types-into-schema.ts`).
   Measured ~104ms/boot across the 6 calls. Verified: admin SDL byte-identical,
   shop SDL content-identical (top-level type print order shifts only).

3. **`perf(core): avoid eager loading of heavy dependencies at import time`**
   `import { Query } from '@nestjs/graphql'` in decorator-only files pulled the
   whole barrel (drivers, federation, graphql-tools, subscriptions-transport-ws,
   fast-glob). Switched to subpath imports; `express` and `http-proxy-middleware`
   made lazy. Removed ~500 modules from the eager graph. The worker benefits most
   (it never serves GraphQL but paid the full graph).

4. **`perf(core): cache graphql type definition loading across api builds`**
   The 31 `common/*.graphql` files were globbed, read and merged twice (once per
   API). Now cached per glob pattern; merge order preserved via sorted patterns.

Verification: 1190/1190 unit tests; full core e2e suite green (2028 tests — one
suite needed a rerun after a corrupted sql.js cache image, unrelated to the
changes); before/after SDL dumps via `dump-sdl.js`; worker health endpoint and
proxy-handler smoke tests.

## Cloud deployment guidance (no code changes needed)

- Set `NODE_COMPILE_CACHE=/app/.node-compile-cache` for server AND worker (they
  can share the dir; concurrency-safe; ~16MB).
- Warm it in the final Docker image stage by running a full `bootstrap()` +
  `close()` cycle against a throwaway sqlite config (a bare `require` misses ~28%
  of modules). The cache is keyed to the exact node binary — warm-up must run in
  the same final-stage image that ships.
- Opt-out: `NODE_DISABLE_COMPILE_CACHE=1`. Node <22.8 and Bun silently ignore the
  env var (verified), so no guards needed.
- Not worth it (measured): `--max-semi-space-size` tuning (no effect),
  `--no-lazy` (~8% worse), `node --build-snapshot` (infeasible: native addons,
  user-land module restrictions, live handles).

## Tolerating slow user code at boot (beyond in-process optimization)

Real plugins do awaited external HTTP calls (license checks), open extra DB
connections and create dozens of job queues in lifecycle hooks, and Nest runs
module hooks strictly serially — core cannot optimize that away. Two workstreams:

- **Early-listen prototype (working, prototype branch, not yet merged)**:
  opt-in `experimentalEarlyListen` bootstrap option binds the port with a bare
  `net.Server` (`pauseOnConnect`) right after `preBootstrapConfig()`, holds up to
  1000 connections, and replays them into Nest's HTTP server after `app.init()`.
  Measured: port connectable ~430ms into boot instead of ~1400ms with a simulated
  400ms external call; all held GraphQL requests complete correctly; clean
  SIGTERM during the holding phase. Before merging: make `app.close()` close the
  early listener (e2e harnesses call it directly), extend signal coverage, and
  decide on the `address()`/`isListening` shims vs constructing the real listener
  up front.

- **Checkpoint/restore research (decision-ready)**: the shippable option now is a
  **standby-process pool** exploiting Vendure's existing seam (config is set
  before `AppModule` is dynamically imported): keep generic processes that have
  loaded node+core+deps but no tenant config, bind one to a tenant on demand —
  removes the module-load fraction entirely. True `fork()`-after-preload is not
  viable in Node (multi-threaded runtime). CRIU/k8s container checkpointing is
  still forensic-oriented in 2026 (containerd support unmerged) and captures
  secrets in plain memory dumps; Firecracker/microVM suspend-resume only applies
  if the platform owns the VM layer. Recommended next step regardless of
  mechanism: an additive opt-in restore-hook API in core
  (`beforeCheckpoint`/`afterRestore`, strong-reference registry, LIFO/FIFO
  ordering per CRaC), which doubles as graceful pause/resume scaffolding.

## Remaining opportunities (not implemented)

- **Double schema build (~50ms/boot)**: Vendure hands Apollo `typeDefs:
  printSchema(builtSchema)`, which `@nestjs/graphql` re-parses and rebuilds via
  `makeExecutableSchema` in `app.init()`. Passing `schema:` instead silently
  DROPS all explored decorator resolvers (verified in `graphql.factory.js`) — do
  not do the naive swap. Proper fix is upstream in `@nestjs/graphql`: a fast path
  that attaches explored resolvers to a pre-built schema via
  `addResolversToSchema`.
- **i18n preload (~3-5ms)**: preload only configured languages, keep
  `supportedLngs` for lazy loading. Tiny; genuine (minor) behavior change.
- **Compile-cache opt-in in core (2-5%)**: `VENDURE_COMPILE_CACHE=true` gating
  `module.enableCompileCache()` at the top of core's index. Deliberately not done
  — env-var guidance achieves nearly the same with zero code.
