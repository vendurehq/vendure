# vendure schema

Generates a schema file from a Vendure GraphQL API (Admin or Shop).

## Usage

```bash
vendure schema -a <admin|shop> [options]
```

## Options

| Option                     | Required | Description                                                         |
| -------------------------- | -------- | ------------------------------------------------------------------- |
| `-a, --api <admin\|shop>`  | **Yes**  | Which GraphQL API to generate a schema for                          |
| `-d, --dir <dir>`          | No       | Output directory (default: current directory)                       |
| `-n, --file-name <name>`   | No       | Output file name (default `schema.graphql\|json` / `schema-shop.*`) |
| `-f, --format <sdl\|json>` | No       | Output format: SDL or JSON                                          |
| `--config <path>`          | No       | Path to a custom Vendure config file                                |

## Examples

```bash
vendure schema -a admin                       # admin schema, SDL, cwd
vendure schema -a shop -f json -d ./schemas   # shop schema as JSON
vendure schema -a admin -n admin-api.graphql
```
