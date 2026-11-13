# OSS-1007: Fix timezone handling (Postgres timestamps, channel and user timezones) — spike report

## Summary

* The dashboard formats dates correctly: it shows each instant in the browser's local time. Wrong times on screen come from four places:
  * **Wrong instants from the server on Postgres.** Postgres `timestamp` columns are written and read by node-postgres in the **Node process timezone**. `createdAt`/`updatedAt` are filled by Postgres in the **session timezone**. Whenever those two differ (e.g. a dev laptop in Vienna with Postgres in Docker on UTC), `createdAt`/`updatedAt` are off by the difference: −1/−2 h in Vienna, +8/+7 h in Los Angeles, −5.5 h in Kolkata.
  * **Process timezone changes.** Every stored date shifts when the process timezone changes (dev data → UTC container, or an API server and a worker with different `TZ`).
  * **The dashboard metrics chart.** It re-buckets days on the server: one picked day becomes two bars, and labels are −1 day for users west of UTC.
  * **Date filters.** They filter on local-midnight instants, so "on 29 March" matches nothing.
* MySQL/MariaDB with Vendure's default `timezone: 'Z'` is correct, unless the server `time_zone` is not UTC. Then `createdAt`/`updatedAt` are off by its offset (#1375).
* SQLite is correct everywhere.
* TypeORM v1 (f7379b767) changes nothing. The harness gives identical results on 0.3.28 and 1.1.2.
* **Recommendation:** in v4.0, store all date columns on Postgres as `timestamptz`, with a migration helper. Do not let TypeORM generate this migration: its generated SQL drops and re-adds every date column, which deletes the data.
* Also in v4.0: pin the MySQL/MariaDB session `time_zone` to UTC, and send list-filter dates with an explicit `Z`.
* The prototype does all of this. All targeted e2e tests pass in four process timezones, and on Postgres/MySQL/MariaDB servers in non-UTC zones.
* Channel timezone, user/customer timezone, email date formatting and the dashboard fixes are additive. They can follow in v4.x.

## Discrepancy matrix

Measured, not reasoned. The TypeORM-level harness (`.spike/tz-harness/`) writes 10 known instants through the same column definitions Vendure uses, then reads them back raw, through TypeORM, through Vendure's list-filter SQL and through the dashboard metrics SQL. It covers 70 scenarios × 2 TypeORM versions. The instants include winter and summer, both Vienna and Los Angeles DST edges, and a Kolkata midnight. Full tables: `.spike/results/matrix-typeorm-v1.md` (and `-03.md`).

A Vendure-level e2e test (`packages/core/e2e/timezone.e2e-spec.ts`) confirms the key rows through GraphQL. The dashboard rows come from a unit harness under four browser zones (`.spike/OSS-1007-dashboard-findings.md`).

"Read back" is what Vendure, and so GraphQL, returns. GraphQL itself adds no error: `graphql-scalars` `DateTime` serialises with `toISOString()` and rejects inputs without an offset. ✅ = correct instant. Offsets are *returned − true*.

### Server and database (current behaviour on `major`)

| # | Scenario | How common | Stored raw (Date cols) | createdAt / updatedAt (DB default) | Date cols read back (orderPlacedAt, startsAt, deletedAt, custom `datetime`) | List filter on dates (`DateOperators`) | Metrics day bucket | Mechanism |
|---|---|---|---|---|---|---|---|---|
| P1 | PG, Node `TZ=UTC`, PG `timezone=UTC` | **Most production containers / managed PG** | UTC wall time ✅ | ✅ | ✅ | ✅ | UTC day | All three clocks agree |
| P2 | PG, Node UTC, PG server zone ≠ UTC (e.g. Vienna, LA) | Common on self-hosted PG: `initdb` copies the OS zone | ✅ | ❌ +1/+2 h (Vienna), −8/−7 h (LA) | ✅ | ✅ Date cols, ❌ on createdAt | UTC day | `now()` → `timestamp` in session tz, read as Node-local (UTC) |
| P3 | PG, Node local (Vienna / LA / Kolkata), PG UTC | **Every dev laptop with Docker PG** | local wall time (+1/+2, −8/−7, +5.5 h vs UTC) | ❌ −1/−2 h, +8/+7 h, −5.5 h | ✅ except the repeated DST hour: ❌ −1 h | ❌ misses all rows (shift = Node offset) | Node-local day | node-postgres writes `Date` as local time with offset, PG drops the offset for `timestamp`, reads it back as local (`pg/lib/utils.js:95`, `postgres-date/index.js:50`). Filters send UTC strings (`parse-filter-params.ts:383`) |
| P4 | PG, Node local = PG local (both Vienna) | Laptop with native PG | local wall time | ✅ | ✅ except the repeated DST hour ❌ −1 h | ❌ misses all | Node-local day | As P3, but the clocks agree |
| P5 | PG, Node zone ≠ PG zone, both non-UTC | Rare | local | ❌ sum of both offsets (LA+Vienna: +9 h; Kolkata+LA: −13.5 h) | DST hour ❌ | ❌ | Node-local | P2 + P3 |
| P6 | PG, data written under one `TZ`, read under another (dev → UTC deploy; API and worker differ) | Common at first deploy, and with a mis-set worker | as written | ❌ by the difference | ❌ every value by the offset difference (Vienna→UTC: +1/+2 h; UTC→LA: +8/+7 h) | ❌ | wrong day | Wall times carry no zone |
| P7 | PG, `PGTZ=Europe/Vienna` env | — | ✅ | ✅ | ✅ | ✅ | — | node-postgres ignores `PGTZ`. Only libpq reads it |
| P8 | PG, session forced to UTC (`extra.options: '-c timezone=UTC'`) | Workaround | — | ✅ only if Node is UTC too, else as P3 | as P3 | as P3 | — | Fixes the defaults only |
| M1 | MySQL/MariaDB, `timezone:'Z'` (Vendure default), server `time_zone` UTC | **Default** | UTC ✅ | ✅ | ✅ in every Node TZ | ✅ | UTC day | Driver converts to UTC |
| M2 | MySQL/MariaDB `'Z'`, server `time_zone` ≠ UTC | RDS/Cloud SQL param groups set to local; `SYSTEM` on a local host | ✅ | ❌ +1 h (Vienna) | ✅ | ✅ Date cols, ❌ createdAt | UTC day | `CURRENT_TIMESTAMP(6)` in session tz (#1375) |
| M3 | MySQL/MariaDB with `timezone:'local'` and Node non-UTC | User override | local | ❌ (as P3/P5) | DST hour ❌ | ❌ | Node-local | Same as Postgres `timestamp` |
| M4 | MySQL `TIMESTAMP` type (not used by core; plugins may) with a DST session zone | Plugins | — | — | 💥 insert fails for local times in the spring gap (`'2026-03-29 02:30'`) | — | — | `TIMESTAMP` converts via the session zone. Also limited to 2038 |
| S1 | SQLite / sql.js, any Node TZ | Dev | UTC string ✅ | ✅ | ✅ | ✅ | UTC day | TypeORM stores UTC strings |
| — | PG `timestamptz` (prototype), any Node/server/session zone | — | absolute ✅ | ✅ | ✅ incl. DST | ✅ after the `Z` fix (before it: ❌ when session ≠ UTC) | session-tz day | Absolute instants |

### Consumers

| # | Where | Scenario | Effect | Mechanism |
|---|---|---|---|---|
| C1 | Dashboard metrics chart / Orders Summary (`dashboard/plugin/service/metrics.service.ts:48-49,136-149`) | Any browser zone ≠ server zone | One picked day gives 2 bars. LA labels −1 day. Counts up to 2×, previous period overlaps | The server re-applies `startOfDay/endOfDay` in the Node zone and groups by DB-side date (UTC on MySQL/SQLite, Node-local on PG `timestamp`). The client formats UTC-midnight labels locally |
| C2 | List date filter (`data-table-datetime-filter.tsx:62-79`) | All zones | "On 29 March" → `eq` local-midnight instant → ~0 rows. `between 29..29` has zero width | No date-only semantics |
| C3 | DateTimePicker (`@vendure-io/ui` `date-time-picker.tsx:52-69`) | DST zones | The repeated hour can't be entered, and re-picking shifts −1 h. 02:30 on the spring-forward day silently becomes 03:30. No zone shown | `setHours` |
| C4 | Promotion `endsAt`, custom-field `datetimeMin` messages, language dialog, op-arg descriptions | All | Ends at 00:00 local. A min of `'2026-01-01'` reads as UTC midnight (LA message says 31 Dec). Raw ISO in descriptions | See dashboard findings F-08..F-11 |
| C5 | Email `formatDate` (`email-plugin/src/generator/handlebars-mjml-generator.ts:43-50`) | Worker `TZ` | Order confirmation shows `orderPlacedAt` in the worker's zone, with no zone label: Kolkata "Mon May 11 00:15", LA "Sun May 10 11:45" for the same order. With `TZ=UTC` (the #3409 workaround) customers get UTC times | `dateformat` uses process local time |
| C6 | Job retry back-off (`sql-job-queue-strategy.ts:251`) | P2/P3/P5 | `Date.now() - updatedAt` is off by the offset. Node west of PG: retries are delayed by hours (LA: +8 h). East: back-off is skipped | `updatedAt` is DB-filled (from the matrix; not run separately) |
| C7 | Session cleanup (`session.service.ts:500`), settings-store expiry (`settings-store.service.ts:471`) | P2/P3 | Expiry window shifted by the offset | Compares a DB-filled `updatedAt` with a JS `Date` |
| C8 | Scheduled tasks | Any | Cron runs in the process zone unless `schedulerOptions.timezone`/task `timezone` is set. Already fixed by #5203 on this branch (`scheduler/schedule-timezone.ts`) | — |

**What the maintainer has probably seen:** a dev setup in a non-UTC zone with Postgres in Docker (P3) shows every `createdAt`/`updatedAt` 1–2 hours early, while `orderPlacedAt` looks right (#1719). It also produces the metrics chart's doubled or −1-day buckets (C1), and date filters that return nothing (C2).

## Recommendation

**Do in v4.0** (the storage change and its migration), then **v4.x** for the additive parts.

v4.0 (breaking, prototyped):
1. Postgres: every date column becomes `timestamptz`: `createdAt`/`updatedAt`/`deletedAt`, every `Date`-typed column (core and plugin entities) and custom fields of type `datetime`. Opt-out: `entityOptions.timestampColumnType: 'timestamp'`.
2. The `migrateTimestampColumnsToTimestamptz()` / `revertTimestamptzMigration()` / `previewTimestamptzMigration()` helpers.
3. Refuse `synchronize` while legacy columns exist. Make `vendure migrate` generation emit the helper call instead of DROP/ADD (not yet prototyped).
4. Postgres list filters send `…Z` instants.
5. MySQL/MariaDB: when the driver `timezone` is UTC (the default), set the session `time_zone='+00:00'` on every pooled connection.
6. A startup warning for the remaining unsafe settings (legacy `timestamp` mode, `timezone:'local'`).

v4.x (non-breaking):
7. Dashboard fixes: metrics bucketed in a client-supplied IANA zone, date-only filter semantics, a zone label in the pickers, small fixes.
8. `Channel.timezone`.
9. Customer/Administrator timezone with a resolution strategy.
10. Timezone-aware `formatDate` in emails.

## What was investigated

* **Columns.** The base entity uses `@CreateDateColumn()`/`@UpdateDateColumn()` (`entity/base/base.entity.ts:44,46`). TypeORM maps these to `timestamp` on PG (`node_modules/typeorm/driver/postgres/PostgresDriver.js:196`) and to `datetime(6) DEFAULT CURRENT_TIMESTAMP(6)` on MySQL (`MysqlDriver.js:192-196`). There are 12 entities with `@Column({ type: Date })` (`deletedAt`, `lastLogin`, `startsAt`/`endsAt`, `expires`, …). Others are inferred from the TS type: `Order.orderPlacedAt` (`order.entity.ts:92`), `pricingUpdatedAt` (`:109`), job `startedAt`/`settledAt`, scheduler `lockedAt` etc., cache `expiresAt`. Custom field `datetime` is `'timestamp'` on PG (`register-custom-entity-fields.ts:403-411`, before the prototype). A default schema with one datetime custom field has **140** such columns.
* **Write path.** TypeORM passes the `Date` through (`PostgresDriver.js:529-533`). node-postgres serialises it as local time with an offset (`pg/lib/utils.js:95`; `parseInputDatesAsUTC` is off). PG drops the offset when the target is `timestamp`. Create/update dates come from `now()`/`CURRENT_TIMESTAMP` in the session zone.
* **Read path.** pg-types parses OID 1114 as **local** time (`pg-types/lib/textParsers.js:175`, `postgres-date/index.js:50`), then GraphQL calls `toISOString()`.
* **MySQL.** Vendure defaults `timezone: 'Z'` (`config/default-config.ts:155`). The driver converts to UTC, but DB defaults use the session `time_zone`.
* **Filters.** `parse-filter-params.ts:383` converts `Date` to a zone-less UTC string. That is correct for MySQL `'Z'` and SQLite, shifted for PG `timestamp` with non-UTC Node, and shifted for PG `timestamptz` with a non-UTC session.
* **Metrics.** `dashboard/plugin/service/metrics.service.ts:48-49,136-149`.
* **Email.** `email-plugin/src/generator/handlebars-mjml-generator.ts:43-50`, default template `templates/order-confirmation/body.hbs:60`.
* **Scheduler.** PR #5203 is merged into this branch: `schedulerOptions.timezone` plus per-task `timezone`.
* **Dashboard.** Full map in `.spike/OSS-1007-dashboard-findings.md`.
  * There is no channel, server or user timezone setting anywhere.
  * `FormatBridge` passes no `timeZone`.
  * The only zone indicators are data-table cells (`timeStyle:'long'`) and filter badges.
* **Linked issues.**
  * #1719 is P2/P3.
  * #3409 is P3, closed with the "set `TZ=UTC`" workaround. That workaround conflicts with #5202 (local-time cron), which #5203 resolved separately.
  * #1375 is M2.
  * #3451 and Discussion #4321 are user and channel timezones; see below.
* **TypeORM v1 vs 0.3.28.** Identical matrices for postgres/mysql/mariadb (`results-v1.jsonl` vs `results-v03.jsonl`). v1 neither fixes nor changes anything here.

## Design options considered

| Option | Pros | Cons | Verdict |
|---|---|---|---|
| A. PG `timestamptz` for all date columns (+ helper migration) | Absolute instants, independent of Node/server/session zones. Fixes DST ambiguity. SQL/BI tools see correct values. Standard practice | Migration for every PG install. TypeORM's generated SQL would drop data, so a helper and a guard are needed. Plugin entity columns change too | **Chosen** |
| B. Keep `timestamp`, force UTC in the driver (`setTypeParser(1114, s => new Date(s+'Z'))`, `parseInputDatesAsUTC`, session `timezone=UTC`) | No schema change. Existing data written with `TZ=UTC` needs nothing | Mutates the global `pg` module for every library in the process. Needs the session option (some poolers reject startup `options`). Data written under a non-UTC `TZ` still needs a data migration. Still semantically zone-less | Rejected. Possible fallback for users who opt out |
| C. Document "run everything in UTC" (status quo) | No code | Already the advice since #1375/#3409, and still bites (P3 on every dev laptop). Conflicts with local-time cron (now solved by #5203) | Rejected |
| D. MySQL: switch to `TIMESTAMP` columns | Session-zone conversion built in | 2038 limit (promotion `endsAt`, custom fields). Insert failures in DST gaps (M4) | Rejected |
| E. MySQL: pin session `time_zone='+00:00'` when the driver writes UTC | Fixes M2 without schema change. Invisible to users already in UTC | Patches the driver's pool factory (`initialize-data-source.ts`). Existing wrong `createdAt` rows stay wrong (SQL fix below) | **Chosen** |
| F. MySQL: set `createdAt`/`updatedAt` in JS (subscriber) | No session dependence | Misses query-builder inserts/updates (`UPDATE … SET updatedAt = CURRENT_TIMESTAMP`) | Rejected |

## Prototype

Branch `mbromley/oss-1007-spike-fix-timezone-handling-postgres` (off `major`). Commits:
* `afffe7b40` lane ports (do not merge)
* `dad607a5a` harness, results and failing e2e
* `3a63b6acc` core prototype
* `7fe402d5e` MySQL pin, sync guard, benchmark

Key files:
* `packages/core/src/config/vendure-config.ts`: `EntityOptions.timestampColumnType` (default `'timestamptz'`), set in `default-config.ts`.
* `packages/core/src/entity/set-timestamp-column-types.ts`: rewrites TypeORM metadata args on PG before the DataSource is built.
  * It converts create/update/delete-date columns without an explicit type, and every `type: Date` column.
  * It follows parent classes and embedded classes, so custom fields are included.
  * Explicit string types such as `'timestamp'` are left alone.
  * It is idempotent.
  * Called from `bootstrap.ts` `preBootstrapConfig()`.
* `register-custom-entity-fields.ts:408`: datetime custom fields on PG are registered as `Date`, so the same switch applies.
* `service/helpers/list-query-builder/parse-filter-params.ts:383`: on PG, filter dates are `toISOString()`.
* `connection/initialize-data-source.ts`:
  * `pinMysqlSessionTimezone()`: wraps `driver.mysql.createPool` so that each new connection runs `SET time_zone='+00:00'`.
  * `assertNoLegacyTimestampColumns()`: refuses `synchronize`.
* `connection/check-database-timezone.ts`: startup warnings, called from `bootstrap()` and `bootstrapWorker()`.
* `migration-utils/v4_0_timestamptz.ts` (exported from `@vendure/core`):
  * `previewTimestamptzMigration()`: lists the columns and estimates *process offset − DB offset* per month from `orderPlacedAt` vs the first payment's `createdAt`.
  * `migrateTimestampColumnsToTimestamptz(qr, { processTimezone, databaseTimezone?, lockTimeout? })`.
  * `revertTimestamptzMigration()`.
  * `findTimestampColumnsToMigrate()`.
* Not prototyped:
  * the dashboard fixes
  * `Channel.timezone` / user timezone
  * email `formatDate` timezone
  * rewriting generated migrations in `vendure migrate`

## Testing done

* **TypeORM harness** (`.spike/tz-harness/run.cjs`): 70 scenarios on TypeORM 1.1.2.
  * PG: 3 server zones × 2 session modes × 4 Node zones, plus 5 cross-zone reads and `PGTZ`.
  * MySQL and MariaDB: 2 global zones × `'Z'`/`'local'` × 4 Node zones, plus cross-zone reads.
  * better-sqlite3 and sql.js.
  * The PG/MySQL/MariaDB part was rerun on TypeORM 0.3.28 with identical results.
* **New e2e `timezone.e2e-spec.ts`** (6 tests: createdAt instant, DST round-trip incl. custom field, list filters on createdAt and on a Date column, order createdAt/updatedAt/orderPlacedAt agreement, orderPlacedAt filter):
  * Before the prototype:
    * PG with `TZ=UTC`: 6/6 pass.
    * PG with `TZ=Europe/Vienna`: **4 fail**.
    * PG with `TZ=America/Los_Angeles`: **5 fail**.
    * sql.js in Vienna and LA: 6/6.
    * MySQL with server `time_zone` Vienna: **3 fail**.
    * MariaDB with server Vienna / Node LA: **3 fail**.
  * With the prototype:
    * PG in UTC / Vienna / LA / Kolkata: 6/6 each.
    * PG server in LA with Node Vienna or Kolkata: 6/6.
    * MySQL Vienna/UTC, MariaDB Vienna/LA, MySQL LA/Kolkata: 6/6 each.
  * Opt-out `timestampColumnType:'timestamp'` in Vienna: fails as before (5), as expected.
* **New e2e `timezone-migration.e2e-spec.ts`** (PG):
  * Steps:
    1. Write data in legacy mode.
    2. Check that `synchronize` refuses.
    3. Preview, then migrate.
    4. Confirm TypeORM's schema diff is then empty for date columns, and that a second run is a no-op.
    5. Restart in `timestamptz` mode and check every value.
    6. Revert and re-migrate.
  * Results: 3/3 in UTC, Vienna, LA and Kolkata, and with PG server LA + Node Vienna (mixed source zones).
* **Unit:** `check-database-timezone.spec.ts`, 5/5 in UTC and Vienna.
* **Full core e2e on Postgres, `TZ=Europe/Vienna`, prototype `3a63b6acc`:** 2848 passed, 0 failed, 38 skipped. The two `migrate-*` specs initially errored because another project's Jaeger container holds port 17086 in this lane's range; they pass on a shifted port. `migrate-from-empty` also passes, so a fresh v4 schema generates cleanly with `timestamptz`.
  * PENDING-PG2
  * PENDING-MARIADB
* **Dashboard:** unit harness (15 tests × 4 browser zones) at `packages/dashboard/src/lib/__tz-spike__/`. Playwright was not run.
* **Not tested:**
  * MySQL `aurora-mysql`
  * PgBouncer/pooler behaviour
  * the dashboard UI end to end
  * the email plugin beyond a `dateformat` check
  * the job back-off claim (C6) directly
  * zones with 30-minute DST shifts (Lord Howe), which the helper's DST rule assumes is 1 h

## Migration story

**Postgres (v4.0, required unless opting out).**

1. **Find the zones the old data was written in.**
   * `processTimezone`: the `TZ` of the server and worker processes. This zone applies to every non-default date column.
   * `databaseTimezone`: `SHOW timezone` of the old sessions, which defaults to the current one. This zone applies to `createdAt`/`updatedAt`.
   * `previewTimestamptzMigration()` prints the per-month median of *orderPlacedAt − first payment createdAt*. 0 h means both zones were the same. A value that changes with DST (1 h in winter, 2 h in summer) means e.g. Node in Vienna with PG in UTC. In the e2e it correctly reported 0 h (Node and PG both UTC) and +1 h (Node Vienna, PG UTC, November).
   * Containers and managed PG are almost always `UTC`/`UTC`.
2. **Write a migration** whose `up()` calls `migrateTimestampColumnsToTimestamptz(queryRunner, { processTimezone: 'UTC' })` and whose `down()` calls `revertTimestamptzMigration(...)`. **Delete** any `DROP COLUMN`/`ADD … TIMESTAMP WITH TIME ZONE` lines that `vendure migrate` generated for these columns. Proposed v4 work: have the generator emit the helper call itself.
3. **What the helper does.** It converts only the columns that are `timestamptz` in the metadata and still `timestamp` in the DB, with one `ALTER TABLE` per table.
   * If the source zone is UTC, it runs `SET LOCAL timezone='UTC'` and `ALTER … TYPE timestamptz` with no `USING`. PG 12+ then **skips the table rewrite**, but indexes on the columns are still rebuilt.
   * Otherwise it uses `USING col AT TIME ZONE '<zone>'`. For the repeated DST hour it picks the *earlier* instant, so values match what pre-v4 Vendure displayed. PG alone picks the later one, which the Vienna e2e caught. The conversion was checked against Node's own parsing on both DST edges.
   * ICU legacy names reported by Node (e.g. `Asia/Calcutta`) are mapped to tzdata names, because PG 16 rejects them.
4. **Large tables.** The benchmark (`.spike/results/bench-5m.txt`, PG 16, 5 M rows, 578 MB, 3 date columns, 2 indexes) ran while a full e2e suite was loading the same container, so treat it as an upper bound:
   * UTC source, no rewrite: **6.2 s**. That is index rebuilds only.
   * `AT TIME ZONE` rewrite: **17 s**.
   * Helper DST-safe expression: **14.9 s**.
   * The type change takes an `ACCESS EXCLUSIVE` lock per table for that time, so use `lockTimeout`.
   * For very large `order`/`job_record`/`history_entry` tables and zero downtime: add a `timestamptz` column, backfill it in batches, swap it in a short transaction. Or prune `job_record`/`session` first.
5. **Rollback.** `revertTimestamptzMigration()` (5 M rows: 8.2 s, no rewrite for UTC). Alternatively keep `timestampColumnType: 'timestamp'` and skip the migration.
6. **Data that can't be recovered.** Values in the repeated DST hour that were written under a non-UTC `TZ` are already ambiguous. The helper keeps the pre-v4 reading.

**MySQL/MariaDB.** No schema change. If the server `time_zone` was not UTC, existing `createdAt`/`updatedAt` are off by that zone. A fix per table:

```sql
UPDATE `order` SET createdAt = CONVERT_TZ(createdAt, 'Europe/Vienna', '+00:00'), updatedAt = CONVERT_TZ(updatedAt, 'Europe/Vienna', '+00:00');
```

**Codemod/CLI.** A `vendure migrate` check that detects legacy columns and writes the helper call. A `--preview` that prints `previewTimestamptzMigration()`.

## Breaking changes and impact

* **Admin and Shop API.** No schema change. Values become correct where they were wrong (P2–P6), so API clients may see `createdAt` shift by hours after the upgrade on mis-configured installs. That is the point of the fix, but it needs a changelog note.
* **Dashboard.** Unaffected by the storage change. The fixes are separate (v4.x).
* **Plugins in this repo.** Their `Date` columns become `timestamptz` on PG automatically (job queue, scheduler, cache, mcp-plugin entities) and are covered by the helper.
* **Third-party plugins.**
  * `Date`-typed columns change type on PG. Their raw SQL comparing these columns with zone-less literals now uses the session zone (`timestamptz`).
  * Raw `TO_CHAR`/`DATE()` grouping now follows the session zone instead of the Node zone.
  * Explicit `type: 'timestamp'` columns are untouched.
* **Storefronts.** None.
* **MySQL users with a non-UTC server.** `createdAt` from the upgrade on is correct, so older rows stay off until they run the SQL fix.

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A user runs the TypeORM-generated migration (DROP/ADD) and loses every date | High without guard | Critical | Sync guard (prototyped). Generator rewrite and loud docs (v4.0 must-have) |
| Wrong `processTimezone` given to the helper | Medium | Values shifted by hours | `previewTimestamptzMigration()` estimate. `revert` and re-run |
| Long locks on huge tables | Medium for large shops | Downtime of seconds to minutes | `lockTimeout`. UTC no-rewrite path. Batch/swap recipe. Prune job/session tables first |
| `driver.mysql.createPool` wrapper breaks on a TypeORM/mysql2 change | Low | MySQL `createdAt` drift returns | Startup check warns. A unit test on the hook. Ask TypeORM for an init-SQL option |
| Third-party raw SQL relies on Node-local `timestamp` values | Low | Off-by-offset reports | Changelog, opt-out flag |
| Session zone ≠ UTC changes DB-side day bucketing (`TO_CHAR`) | Medium | Metrics in session zone | Bucket with explicit `AT TIME ZONE :tz` (dashboard fix) |

## Channel and user timezones

Timestamps that are *events* (`createdAt`, `orderPlacedAt`, history) are absolute instants. They should always be stored as such (above) and shown in the **viewer's local time**, with the zone visible on hover. That is what the dashboard already does, and it is correct.

A zone is only needed where a *wall-clock intention* is involved:

* **Scheduling inputs**: promotion `startsAt`/`endsAt`, `datetime` custom fields. The admin means "the shop's 18:00", not their own. Add a nullable `Channel.timezone` (IANA, validated with `Intl`), as proposed in Discussion #4321.
  * The dashboard pickers enter and show these fields in the channel zone when it is set, and label the zone.
  * Otherwise they use the browser zone, also labelled.
  * Storage stays UTC instants.
* **Calendar buckets** ("today", per-day metrics, "orders on 29 March"). Use the channel zone when set, else the browser zone. Pass it explicitly to `dashboardMetricSummary(input: { timezone })` and bucket with `AT TIME ZONE`.
* **Emails** (#3451). Resolve the recipient zone through a `TimezoneStrategy`/resolver:
  1. customer (or administrator) `timezone`
  2. channel `timezone`
  3. `UTC`
  
  Give `formatDate` an optional zone (`{{formatDate order.orderPlacedAt "long" tz}}`) implemented with `Intl.DateTimeFormat({ timeZone })` instead of `dateformat`.
* **User timezone.** `Administrator` gets a dashboard display preference (stored with the dashboard user settings), defaulting to the browser zone. `Customer` gets a nullable `timezone` for emails. This is better than putting the field on `User`, because one `User` can be an administrator in several channels.
* **Scheduled tasks** already have `schedulerOptions.timezone` (#5203). Per-channel schedules are out of scope.

**Multi-channel fit.**
* With role assignments, an administrator can work in several channels, e.g. vendors in different countries. `Channel.timezone` lets each channel's promotion windows and daily reports follow that channel's day, while event times stay in the viewer's zone.
* It also gives marketplace sellers (`Seller` → channel) a natural home for their local business day.
* All of this is additive (v4.x), but only reliable once storage is absolute (v4.0).

## Cross-spike notes

* All sibling spikes that add tables or columns (OSS-999 channel-scoped identity, OSS-1000 per-channel slugs, OSS-1001 `ProductVariantChannel.enabled`, OSS-1002 inventory) inherit `createdAt`/`updatedAt` from `VendureEntity`. On PG these become `timestamptz` under this change.
  * Their v4 migrations should be generated **after** this change, or the timestamptz helper should run last. It converts any remaining `timestamp` columns it finds.
  * Their migration tests on PG should expect `timestamp with time zone`.
* Generated migrations in other spikes may contain the destructive DROP/ADD pairs if they were generated against a database that still had legacy `timestamp` columns. Strip those pairs from them.
* The new `initializeDataSource()` sync guard throws on a PG database with legacy columns. Sibling e2e tests that reuse an old PG `__data__` database need a fresh one.

## Open questions for the maintainer

1. **Default for existing installs.** Should `timestampColumnType` default to `'timestamptz'` (forcing the migration on upgrade) or to `'timestamp'` with a deprecation warning? *Recommended: `'timestamptz'`. The sync guard makes forgetting the migration loud, not destructive.*
2. **Generated migrations.** Should `vendure migrate` rewrite the destructive pairs into a helper call automatically? *Recommended: yes, in v4.0.*
3. **The MySQL pool patch.** Ship it, or only warn? *Recommended: ship it, and also ask TypeORM upstream for an init-SQL hook.*
4. **Channel timezone scope.** Should it apply to scheduling inputs and calendar buckets only, or also to display? *Recommended: inputs and buckets only; display stays in the viewer's zone.*
5. **Email date format.** Changing `formatDate` from `dateformat` to `Intl` changes the default output string. *Recommended: v4.0, with the old format preserved when a `dateformat` mask is passed.*
6. **Raw SQL against `timestamptz`.** Should Vendure also force the PG session to UTC (`-c timezone=UTC`), so that raw SQL behaves the same everywhere? *Recommended: no. It breaks some poolers, and the code no longer needs it. Document it instead.*

## Effort estimate

| Item | Low | Likely | High (engineer-days) |
|---|---|---|---|
| Core: timestamptz switch, filter fix, MySQL pin, startup check (harden the prototype, unit tests) | 1.5 | 2.5 | 4 |
| Migration helper hardening, `vendure migrate` generator integration, docs/guide | 2 | 3.5 | 6 |
| Large-table recipe (batch/swap) and benchmark on 50M+ rows | 0.5 | 1 | 2 |
| Dashboard fixes C1–C4 (metrics zone param, filter semantics, picker zone label, small fixes) | 2 | 4 | 6 |
| `Channel.timezone` (entity, API, dashboard inputs and buckets) | 2 | 3 | 5 |
| Customer/Administrator timezone + email `formatDate` with zone + resolver | 1.5 | 2.5 | 4 |
| **Total** | **9.5** | **16.5** | **27** |
| v4.0-blocking subset (first three rows) | 4 | 7 | 12 |
