# Server and worker startup failures

Applies to: Vendure 3.x. `vendure doctor` needs v3.7 or later. Notes for
other versions are in the checks.

## Symptoms

- `vendure dev`, `vendure start`, `node ./dist/index.js` or
  `node ./dist/index-worker.js` exits with an error.
- The server starts, but jobs are never processed: the search index does not
  update, collections do not update, emails are not sent.
- The worker health check does not answer.

## Checks

Do them in this order. Use the context from `context.md`.

1. **Node.js version.** Vendure supports Node.js v20, v22 and v24.
   Doc: `getting-started/installation#requirements`
2. **doctor result.** Read the first `fail` in the report. A failed `project`
   check means the command did not run in a Vendure project, or no config file
   was found. Run it again from the project root, or pass `--config <path>`.
3. **Dependencies.** A `fail` with `DB driver "<pkg>" not installed` means the
   driver for `dbConnectionOptions.type` is missing (`pg` for postgres,
   `mysql2` for mysql and mariadb, `better-sqlite3` for sqlite).
   `node_modules not found` means the install did not run. A version mismatch goes to
   `version-mismatch.md`.
4. **Config.** `Failed to load Vendure config` has the error in `details`.
   `Plugin compatibility issues detected` goes to `version-mismatch.md`.
5. **Schema.** `Admin API schema failed` or `Shop API schema failed` means a
   plugin's GraphQL extension or a custom field type does not build. The
   `details` line has the GraphQL error.
   Doc: `developer-guide/extend-graphql-api`
6. **Database connection.** Ask the user first. Then run
   `vendure doctor --check database`. A `warn` with
   `Could not connect to <type> database` means the host, port, credentials or network are wrong.
   The user must check the values. Do not read them yourself.
   Doc: `developer-guide/configuration#connecting-to-the-database`
7. **Startup log.** Ask the user for the startup output. Look for:
   - `Your database schema does not match your current configuration`: go to
     `migrations.md`.
   - `Plugin "<name>" is not compatible with this version of Vendure`: go to
     `version-mismatch.md`.
8. **Production install.** When dev dependencies were pruned, `@vendure/cli`
   is not installed. Then `vendure start` fails. See the `vendure-cli` skill
   rule 4 and `skills/vendure-cli/commands/start.md`.
9. **Worker.** The worker runs `bootstrapWorker(config)` and then
   `startJobQueue()` with the same config as the server. Check that the
   worker process runs, that it uses the same config, and that the job queue
   strategy is not in-memory. An in-memory queue does not work with a separate
   worker process. `vendure doctor --profile production --check project config`
   warns about `InMemoryJobQueueStrategy`.
   Doc: `developer-guide/worker-job-queue#the-worker`,
   `developer-guide/worker-job-queue#jobqueuestrategy`

## Remedies

| Cause                                   | Remedy                                                                                           | Reference                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| Unsupported Node.js version             | Use Node.js v20, v22 or v24                                                                      | `getting-started/installation#requirements`                  |
| Missing database driver                 | Install the driver package that doctor names                                                     | `developer-guide/configuration#connecting-to-the-database`   |
| Config does not load                    | Fix the error in the doctor `details`, then run `vendure doctor --check config` again            | `developer-guide/configuration`                              |
| GraphQL schema does not build           | Fix the plugin's schema extension, then run `vendure doctor --check config schema`               | `developer-guide/extend-graphql-api`                         |
| Schema does not match the config        | Generate and run a migration                                                                     | `cases/migrations.md`                                        |
| CLI missing in a production image       | Start the compiled entry files with `node`, or make `@vendure/cli` a production dependency       | `skills/vendure-cli/commands/start.md`                       |
| Jobs not processed                      | Start the worker; use `DefaultJobQueuePlugin` or `BullMQJobQueuePlugin`, not the in-memory queue | `developer-guide/worker-job-queue#jobqueuestrategy`          |
| Several instances lose sessions or jobs | Share the job queue and cache, and set one cookie secret for all instances                       | `deployment/horizontal-scaling#multi-instance-configuration` |
| Worker health check does not answer     | Call `startHealthCheckServer({ port })` after `startJobQueue()`                                  | `deployment/using-docker#healthreadiness-checks`             |

## Version notes

- Since v3.6.0, the server `/health` route always returns `{ "status": "ok" }`
  when the process serves HTTP. It does not check the database. A passing
  `/health` does not prove that the database is reachable.
  Doc: `core-concepts/healthchecks`
- Since v3.7.4, `runMigrations()` at startup reports `schema-out-of-sync` and
  `no-migrations-matched`. See `migrations.md`.

All references are paths under `https://docs.vendure.io/current/core/`.
