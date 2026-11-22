# vendure migrate

Generates, runs or reverts TypeORM database migrations for a Vendure project.

## Usage

```bash
vendure migrate generate <name> [options]
vendure migrate run [options]
vendure migrate revert [options]
```

| Command    | Description                                                     |
| ---------- | --------------------------------------------------------------- |
| `generate` | Generate a new migration from pending schema changes            |
| `run`      | Run all pending migrations                                      |
| `revert`   | Revert the most recent migration, after a preview and a consent |

Add `--json` to get one JSON document on stdout. Without a name, `generate`
returns `incomplete` with an `input` need for `name`. `revert --json` returns
an `incomplete` result with a `revertMigration` consent need; pass its digest
back with `--revert-migration <digest>`.

`-g, --generate <name>` and `-r, --run` still work and run `generate` and `run`.

## Options

| Option                | Description                                      |
| --------------------- | ------------------------------------------------ |
| `--output-dir <path>` | Output directory for a generated migration       |
| `--from-empty`        | Generate a complete baseline against an empty DB |
| `--config <path>`     | Path to a custom Vendure config file             |

## Notes

- Migrations run against the database configured in the project's Vendure
  config — confirm the intended DB (env vars / config) before running.
- Generate against an up-to-date schema: build the project first if entities
  changed.

## Examples

```bash
vendure migrate generate AddProductReviewTable
vendure migrate generate AddProductReviewTable --output-dir ./src/migrations
vendure migrate run --json
vendure migrate revert
```
