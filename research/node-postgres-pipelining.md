# node-postgres pipelining and Vendure

Research date: 2026-08-20

## Conclusion

`pg@8.23.0` pipelining can reduce latency for a narrow Vendure workload: two or more independent queries must be submitted concurrently through the same TypeORM `QueryRunner`, and therefore the same PostgreSQL connection. It is unlikely to improve all Vendure PostgreSQL traffic by itself. TypeORM usually gives concurrent non-transactional operations separate pool clients, while sequential service code still waits after every query.

The option is technically reachable without a Vendure core change:

```ts
dbConnectionOptions: {
    type: 'postgres',
    // other connection settings
    extra: {
        pipeline: true,
    },
}
```

Do not enable it by default yet. First upgrade the application's `pg` package to at least `8.23.0`, test transaction and streaming paths, and benchmark representative Shop and Admin API operations. The exact throughput gains in the post are not an estimate for Vendure.

## Verification of the post

| Claim | Finding |
| --- | --- |
| `pg 8.23.0` and `pg-native 3.9.0` shipped on August 8 | Correct. The node-postgres [publish commit](https://github.com/brianc/node-postgres/commit/df274d1ba9ad9d11a8f1079314faeafde7208207) lists both versions and is dated 2026-08-08. npm recorded `pg@8.23.0` at `2026-08-08T19:27:05Z` and `pg-native@3.9.0` at `2026-08-08T19:23:57Z`. |
| PR `#3652` added opt-in pipelining | Correct. [PR #3652](https://github.com/brianc/node-postgres/pull/3652) merged on 2026-08-08. |
| `new Client({ pipeline: true })` enables it | Correct for the `pg` client. The same option works on `new Pool(...)` and passes to each client. See the [tagged pipelining guide](https://github.com/brianc/node-postgres/blob/pg%408.23.0/docs/pages/features/pipelining.mdx). Direct users of the lower-level `pg-native` package instead call its `client.pipeline(queries, callback)` batch API. |
| Queries run without waiting for the previous response | Correct. They remain ordered on one backend connection. This removes idle network waits. It does not make one PostgreSQL connection execute statements in parallel. See the [PostgreSQL protocol description](https://www.postgresql.org/docs/current/protocol-flow.html#PROTOCOL-FLOW-PIPELINING). |
| Plain, parameterized, and named prepared statements work | Correct for the documented `client.query()` forms. The [guide](https://github.com/brianc/node-postgres/blob/pg%408.23.0/docs/pages/features/pipelining.mdx) and [integration tests](https://github.com/brianc/node-postgres/blob/pg%408.23.0/packages/pg/test/integration/client/pipelining-tests.js) cover them. The broad phrase "all query types" does not include a documented guarantee for `COPY`, cursors, `pg-query-stream`, or arbitrary custom `Submittable` query classes. |
| It works with Pool | Qualified. A checked-out client can pipeline concurrent calls. `pool.query()` checks out one client for one query, then releases it, so the node-postgres guide states that pipelining has no effect there. |
| It works with PgBouncer | Qualified. PgBouncer has accounted for pipelined `ReadyForQuery` messages since 1.7. Its [feature matrix](https://www.pgbouncer.org/features.html) supports protocol-level prepared statements in session mode. Transaction and statement pooling need PgBouncer 1.21 or newer and a nonzero [`max_prepared_statements`](https://www.pgbouncer.org/config.html#max_prepared_statements). |
| It works with graceful shutdown | Correct. `client.end()` waits for queued and in-flight pipeline queries to drain. See the [released client source](https://github.com/brianc/node-postgres/blob/pg%408.23.0/packages/pg/lib/client.js#L781-L816). |
| The listed 2.22x to 2.40x gains are established results | Not independently verifiable from a primary artifact. The repository contains the [benchmark program](https://github.com/brianc/node-postgres/blob/pg%408.23.0/packages/pg/bench-pipelining.js), which uses batches of 10 for five seconds, but it does not contain that run's output or environment. The official claim is about 2x to 3x for batches of small local queries. |
| PostgreSQL has supported this since 2003 | Broadly correct for the wire protocol. PostgreSQL 7.4 introduced protocol v3 and its extended-query messages in 2003. See the [7.4 protocol changes](https://www.postgresql.org/docs/7.4/protocol-changes.html) and [7.4 release announcement](https://www.postgresql.org/about/news/postgresql-74-released-160/). The dedicated libpq pipeline API arrived in PostgreSQL 14. |
| Craig Ringer and Alvaro Herrera built the libpq API | Incomplete. The [PostgreSQL 14 release notes](https://www.postgresql.org/docs/14/release-14.html) credit Craig Ringer, Matthieu Garrigues, and Alvaro Herrera. Matteo Collina authored node-postgres PR #3652, which Brian Carlson merged. |

## How this reaches Vendure

Vendure passes `dbConnectionOptions` to Nest's TypeORM module without filtering driver fields. See [`ConnectionModule`](https://github.com/vendurehq/vendure/blob/ff11a174468bdab836be4a68c9742a09d6803c03/packages/core/src/connection/connection.module.ts#L38-L50) and the [`VendureConfig` type](https://github.com/vendurehq/vendure/blob/ff11a174468bdab836be4a68c9742a09d6803c03/packages/core/src/config/vendure-config.ts#L1324-L1330).

TypeORM 0.3.28 merges `options.extra` into the configuration passed to `new pg.Pool(...)`. See [`PostgresDriver.createPool()`](https://github.com/typeorm/typeorm/blob/0.3.28/src/driver/postgres/PostgresDriver.ts#L1517-L1553). Therefore `extra: { pipeline: true }` reaches every `pg` client made by that pool.

That wiring is only half of the requirement. TypeORM's [`DataSource.query()`](https://github.com/typeorm/typeorm/blob/0.3.28/src/data-source/DataSource.ts#L526-L544) creates and releases a QueryRunner when the caller does not provide one. Parallel calls normally acquire separate pool clients. Pipelining only starts when multiple unresolved calls reach one client. This can happen when Vendure binds repositories to one transaction manager, as shown in [`TransactionalConnection.getRepository()`](https://github.com/vendurehq/vendure/blob/ff11a174468bdab836be4a68c9742a09d6803c03/packages/core/src/connection/transactional-connection.ts#L138-L157), and application code starts independent repository operations before awaiting them.

Within an explicit transaction, a query error still aborts the transaction. Per-query protocol synchronization cannot make later transaction statements succeed. Dependent reads and writes must remain sequential.

There is also a compatibility risk in setting the option on the whole pool. TypeORM's stream path passes a custom `QueryStream` object to `client.query()`. node-postgres documents ordinary text, parameterized, and named queries, but not custom query classes. PostgreSQL's native libpq pipeline mode explicitly disallows `COPY`. Vendure core does not currently call TypeORM's stream method, but plugins can. Cover streaming, cursors, `COPY`, cancellation, and timeouts before a global default. In the pure JavaScript client, a timeout after a query is on the wire destroys the connection so the pipeline cannot remain blocked; later queries on it fail too. The [integration test](https://github.com/brianc/node-postgres/blob/pg%408.23.0/packages/pg/test/integration/client/pipelining-tests.js#L126-L153) records this behavior.

## Expected performance profile

Good candidates have several short independent statements queued on one transaction-bound connection. Network latency must be material relative to query execution time. A single query, sequential code, long queries, and parallel work spread across pool clients should see little or no gain. Pipelining also increases queued client and server state, as the [PostgreSQL pipeline documentation](https://www.postgresql.org/docs/current/libpq-pipeline-mode.html) notes.

The LinkedIn benchmark measures the best-shaped case: batches of ten trivial queries on one client. Vendure requests include ORM work, application logic, joins, transactions, serialization, and pool contention. Those costs dilute the result.

## Recommended experiment

1. Pin `pg` to `8.23.0` or newer in a Vendure test application. The current repository installs `8.16.3`, even though `packages/core/package.json` declares a compatible caret range for development.
2. Add `extra: { pipeline: true }` only in the benchmark configuration.
3. Run the same seeded Shop and Admin API workloads with the option off and on. Include local PostgreSQL and a realistic production round-trip time.
4. Measure request throughput, p50 and p95 latency, database CPU, pool wait time, statements per checked-out connection, and error rates.
5. Include a workload with concurrent transaction-bound repository calls. Without that case, the benchmark may contain no pipeline at all.
6. Run transaction rollback, query timeout, application shutdown, PgBouncer, and any plugin streaming or `COPY` tests.

Promote the option only if the Vendure-level benchmark shows a repeatable gain without correctness or tail-latency regressions. A useful follow-up is instrumentation that counts pipeline batch depth. It will show whether real requests ever place more than one unresolved query on a client.
