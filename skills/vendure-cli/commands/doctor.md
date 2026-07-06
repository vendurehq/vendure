# vendure doctor

Runs diagnostic checks against a Vendure project and prints an actionable
report. Use it for broken projects, upgrade verification, new-machine setup, or
CI guard rails.

`doctor` is non-interactive: it runs the selected checks and exits.

## Usage

```bash
vendure doctor [options]
```

## Checks

Default checks run in dependency order:

| Check          | Description                                                                     |
| -------------- | ------------------------------------------------------------------------------- |
| `project`      | Project structure, config discovery, package manager and lockfile consistency   |
| `dependencies` | Vendure package version alignment, singleton duplicates and database driver deps |
| `config`       | Config loading, `preBootstrapConfig()` validation and plugin compatibility      |
| `schema`       | Admin and Shop GraphQL schema generation                                        |
| `database`     | Database connectivity using safe read-only overrides                            |

`schema`, `database`, and `production` depend on a successfully loaded config.
If `project` or `config` fails, dependent checks are skipped.

## Options

| Option              | Description                                                                   |
| ------------------- | ----------------------------------------------------------------------------- |
| `--config <path>`   | Path to a custom Vendure config file                                          |
| `--check <names...>` | Run only selected checks: `project`, `dependencies`, `config`, `schema`, `database` |
| `--profile <name>`  | Run profile-specific checks; currently `production`                           |
| `--format <type>`   | Output format: `text` (default) or `json`                                     |
| `--strict`          | Treat warnings as failures; useful for CI                                     |

## Notes

- Run from the Vendure project root, or pass `--config` when the config is not
  in a standard location.
- The production profile adds checks for unsafe deployment settings such as
  disabled auth, default superadmin credentials, missing cookie secret,
  playground/debug/introspection settings, broad CORS, in-memory strategies,
  and missing asset storage/preview strategies.
- `--format json --strict` is the best shape for CI because the command exits
  non-zero for failures and warnings.

## Examples

```bash
vendure doctor
vendure doctor --check dependencies config
vendure doctor --profile production
vendure doctor --strict --format json
vendure doctor --config ./src/vendure-config.ts
```
