# vendure add

Scaffolds a feature into a Vendure project — a new plugin or a piece of an
existing plugin.

## Subcommands

Each feature is its own subcommand. Add `--json` to get one JSON document on
stdout. Without a required input, the command returns `incomplete` with an
`input` need for each missing field, and lists the valid values, such as the
plugins of the project, as `choices`.

| Subcommand                                                     | Creates                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------- |
| `vendure add plugin <name>`                                    | A new plugin, added to the Vendure config                 |
| `vendure add entity <Name> --plugin <Plugin>`                  | An entity in a plugin                                     |
| `vendure add service <Name> --plugin <Plugin> [--entity <E>]`  | A service; with `--entity`, a CRUD service for the entity |
| `vendure add job-queue --plugin <P> --service <S> --name <n>`  | A job queue on a service                                  |
| `vendure add api-extension --plugin <P> --service <S>`         | An Admin API extension with a resolver that calls a service |
| `vendure add dashboard --plugin <Plugin>`                      | Dashboard extensions for a plugin                         |
| `vendure add codegen --plugin <Plugin>`                        | GraphQL codegen configuration for a plugin                |

### Options

| Option                       | Used with       | Description                                                  |
| ---------------------------- | --------------- | ------------------------------------------------------------ |
| `--custom-fields`            | `entity`        | Let the entity have custom fields                            |
| `--translatable`             | `entity`        | Give the entity localized properties                         |
| `--query-name <name>`        | `api-extension` | A query to add, for a service without an entity              |
| `--mutation-name <name>`     | `api-extension` | A mutation to add, for a service without an entity           |
| `--dir <path>`               | `plugin`        | The plugin directory. Defaults to next to the other plugins  |
| `--config <path>`            | `plugin`        | Path to a custom Vendure config file                         |

## Notes

- Names: plugins are lowercase with dashes (`reviews` makes `ReviewsPlugin`).
  Entities and services are PascalCase. Job queues are lowercase with dashes.
- `api-extension` on a CRUD service of an entity adds the entity's type,
  queries and mutations. On any other service it needs `--query-name`,
  `--mutation-name` or both, and returns `incomplete` without them.
- A missing plugin, service or entity is a coded error that lists the ones
  there are: `add.plugin-not-found`, `add.service-not-found`,
  `add.entity-not-found`. A file that already exists is `add.file-exists`.
- `vendure add` with no subcommand shows a menu, for people only.
- The older flags still work and run the same subcommands:
  `-p` is `plugin`, `-e … --selected-plugin` is `entity`, `-s` is `service`,
  `-j` is `job-queue`, `-a` is `api-extension` and `-d` is `dashboard`.

## Examples

```bash
vendure add plugin reviews --json
vendure add entity ProductReview --plugin ReviewsPlugin --custom-fields --translatable --json
vendure add service ProductReviewService --plugin ReviewsPlugin --entity ProductReview --json
vendure add service ReviewService --plugin ReviewsPlugin --json
vendure add job-queue --plugin ReviewsPlugin --service ReviewService --name review-indexing --json
vendure add api-extension --plugin ReviewsPlugin --service ProductReviewService --json
vendure add api-extension --plugin ReviewsPlugin --service ReviewService --query-name reviews --json
vendure add dashboard --plugin ReviewsPlugin --json
vendure add codegen --plugin ReviewsPlugin --json
```
