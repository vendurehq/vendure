# vendure migrate

Generates, runs or reverts TypeORM database migrations for a Vendure project.

## Usage

```bash
vendure migrate [--generate <name> | --run | --revert] [options]
```

Exactly one operation flag:

| Operation flag          | Description                                          |
| ----------------------- | ---------------------------------------------------- |
| `-g, --generate <name>` | Generate a new migration from pending schema changes |
| `-r, --run`             | Run all pending migrations                           |
| `--revert`              | Revert the most recent migration                     |

## Options

| Option                    | Description                                |
| ------------------------- | ------------------------------------------ |
| `-o, --output-dir <path>` | Output directory for a generated migration |
| `--config <path>`         | Path to a custom Vendure config file       |

## Notes

- Migrations run against the database configured in the project's Vendure
  config — confirm the intended DB (env vars / config) before running.
- Generate against an up-to-date schema: build the project first if entities
  changed.

## Examples

```bash
vendure migrate -g AddProductReviewTable
vendure migrate -g AddProductReviewTable -o ./src/migrations
vendure migrate -r
vendure migrate --revert
```
