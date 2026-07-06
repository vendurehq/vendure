# vendure add

Scaffolds a feature into a Vendure project — a new plugin or a piece of an
existing plugin.

## Interactive vs non-interactive

`vendure add` with **no flags** launches an interactive wizard and blocks on
terminal prompts. **Agents must pass an explicit feature flag** so the command
takes the non-interactive path. Passing only `--config` is not enough because
there is no add operation to run.

## Usage

```bash
vendure add <feature-flag> [value] [sub-options]
```

| Feature flag                   | Creates                                                     | Required inputs (non-interactive)                                                  |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `-p, --plugin <name>`          | A new plugin                                                | Plugin class name                                                                  |
| `-e, --entity <name>`          | An entity in an existing plugin                             | Entity class name, `--selected-plugin <name>`                                      |
| `-s, --service <name>`         | A service in an existing plugin                             | Service class name, `--selected-plugin <name>`                                     |
| `-j, --job-queue [plugin]`     | A job queue handler                                         | Plugin value, `--name <name>`, `--selected-service <name>`                         |
| `-c, --codegen [plugin]`       | GraphQL codegen configuration                               | Plugin value                                                                       |
| `-a, --api-extension [plugin]` | An API extension scaffold                                   | Plugin value, `--selected-service <name>`, and `--query-name` or `--mutation-name` |
| `-d, --dashboard [plugin]`     | Dashboard UI extensions                                     | Plugin value                                                                       |
| `-u, --ui-extensions [plugin]` | Admin UI extensions (**deprecated** — prefer `--dashboard`) | Plugin value                                                                       |

### Sub-options

| Sub-option                  | Used with  | Description                                           |
| --------------------------- | ---------- | ----------------------------------------------------- |
| `--selected-plugin <name>`  | `-e`, `-s` | Plugin to add the entity/service to                   |
| `--custom-fields`           | `-e`       | Add custom fields support to the entity               |
| `--translatable`            | `-e`       | Make the entity translatable                          |
| `--type <basic\|entity>`    | `-s`       | Service type (default `basic`)                        |
| `--selected-entity <name>`  | `-s`       | Entity for an entity service (forces `--type entity`) |
| `--name <name>`             | `-j`       | Name for the job queue                                |
| `--selected-service <name>` | `-j`, `-a` | Service to attach the job queue / API extension to    |
| `--query-name <name>`       | `-a`       | Name for the generated query                          |
| `--mutation-name <name>`    | `-a`       | Name for the generated mutation                       |
| `--config <path>`           | any        | Path to a custom Vendure config file                  |

## Notes

- `--entity` and `--service` require `--selected-plugin` in non-interactive
  mode, or the command errors out.
- For entity-backed services, pass `--selected-entity <name>`. Using
  `--type entity` without `--selected-entity` can still prompt for an entity.
- `--job-queue`, `--codegen`, `--api-extension`, `--dashboard`, and
  `--ui-extensions` use optional-value plugin flags, but agents should pass the
  plugin name. In non-interactive mode, omitting it errors before selection can
  happen.
- `--api-extension` also requires an existing service plus at least one
  generated operation name: `--query-name`, `--mutation-name`, or both.
- If the target plugin/service does not exist yet, create it first
  (`vendure add -p <name>`).

## Examples

```bash
# New plugin
vendure add -p ReviewsPlugin

# Translatable entity with custom fields, in an existing plugin
vendure add -e ProductReview --selected-plugin ReviewsPlugin --custom-fields --translatable

# Entity-backed service
vendure add -s ReviewService --selected-plugin ReviewsPlugin --type entity --selected-entity ProductReview

# Job queue on an existing service
vendure add -j ReviewsPlugin --name review-indexing --selected-service ReviewService

# API extension with a query and mutation
vendure add -a ReviewsPlugin --selected-service ReviewService --query-name reviews --mutation-name createReview

# GraphQL codegen + dashboard extensions
vendure add -c ReviewsPlugin
vendure add -d ReviewsPlugin
```
