# Failed or pending migrations

Applies to: Vendure 3.x. `vendure migrate --from-empty` and the startup
diagnostics below need the versions given in the notes.

## Symptoms

- The startup log shows
  `Your database schema does not match your current configuration.` and a
  list of SQL statements.
- The startup log shows `No migration files matched the configured` and
  names the `migrations` patterns.
- `An error occurred when running migrations:` and the server does not start.
- A fresh deployment against an empty database has no tables.
- `vendure migrate -g <name>` creates an empty migration, or none.

## Checks

1. **synchronize.** Find `dbConnectionOptions.synchronize` in the Vendure
   config. It must be `false` in production.
   `vendure doctor --profile production --check project config` reports `synchronize is enabled` as a
   failure.
   Doc: `developer-guide/migrations#synchronize-vs-migrate`
2. **Migration file pattern.** Find `dbConnectionOptions.migrations` in the
   config. Check that the pattern matches the migration files for the way the
   app runs. A pattern that points at compiled output (`dist/`) matches
   nothing until the project is built. That causes `no-migrations-matched`.
   Doc: `developer-guide/migrations#migrations-in-depth`,
   `reference/typescript-api/migration/migration-diagnostic`
3. **Initial migration.** List the migration directory (usually
   `src/migrations`). A project created with `@vendure/create` has an initial
   migration. Without one, a new empty database gets no schema.
   Doc: `developer-guide/migrations#the-initial-migration`
4. **Database engine.** MySQL and MariaDB do not run migrations in a
   transaction. A failed migration can leave the database partly changed. Ask
   the user if a backup exists before any further migration step.
   Doc: `developer-guide/migrations#3-run-the-migration`
5. **Failed migration file.** Ask the user for the error output. Read the
   migration file it names. Compare the `up()` statements with the error.
6. **Version-specific data migrations.** After an upgrade, some generated
   migrations need a helper from `@vendure/core` in `up()`. See `upgrade.md`.

## Remedies

Ask the user before each command. Migration commands change the database
that the config points to. Confirm that this is the intended database.

| Cause                             | Remedy                                                                     | Reference                                                                            |
| --------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Schema does not match the config  | `vendure migrate -g <name>`, review the file, then `vendure migrate -r`    | `developer-guide/migrations#migration-workflow`                                      |
| Pending migrations not applied    | `vendure migrate -r`, or keep `runMigrations(config)` before `bootstrap()` | `developer-guide/migrations#3-run-the-migration`                                     |
| Last migration is wrong           | `vendure migrate --revert`, fix or delete the file, generate again         | `developer-guide/migrations#reverting-a-migration`                                   |
| No initial migration              | `vendure migrate -g initial --from-empty`                                  | `developer-guide/migrations#generating-a-baseline-migration-for-an-existing-project` |
| Pattern matches no files          | Fix `dbConnectionOptions.migrations`, or build the project first           | `reference/typescript-api/migration/migration-diagnostic`                            |
| `synchronize: true` in production | Set `synchronize: false` and use migrations                                | `developer-guide/migrations#synchronize-vs-migrate`                                  |
| Generated migration is empty      | Build the project if entities changed, then generate again                 | `skills/vendure-cli/commands/migrate.md`                                             |

Notes for the remedies:

- `--from-empty` creates and drops a temporary database on PostgreSQL and
  MySQL/MariaDB. The database user must be allowed to create databases. SQLite
  uses an in-memory database.
- Always review a generated migration before it runs. Some changes need a
  manual edit to keep existing data.
  Doc: `developer-guide/updating#database-migrations`
- With MySQL or MariaDB, tell the user to back up the database before
  `vendure migrate -r`.

## Version notes

- `vendure migrate --from-empty` is documented in the CLI guide. Check that
  `vendure migrate --help` lists it in the installed CLI.
- Since v3.7.4, `runMigrations()` reports the `schema-out-of-sync` and
  `no-migrations-matched` conditions. Older versions print only the
  out-of-sync message.

All references are paths under `https://docs.vendure.io/current/core/`, or
files in this repository's `skills/` directory.
