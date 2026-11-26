# Upgrade diagnosis (3.x to the next minor)

Applies to: an upgrade inside Vendure 3.x, for example 3.6 to 3.7 or 3.7 to
3.8. For a major upgrade, read the changelog and ask the docs MCP.

## What a minor version can change

- Underlying dependencies can move to a new major version. The changelog
  lists these.
- The database schema can get non-destructive changes, for example a new
  column. These need a migration. A minor version does not make schema
  changes that can lose data.

Doc: `developer-guide/updating#versioning-policy--breaking-changes`

## Symptoms

- The project does not build after the version change.
- The server does not start, or the log shows that the schema does not match
  the config.
- A plugin is not compatible with the new version.
- GraphQL queries in the storefront or in plugins fail.
- New warnings at startup.

## Checks

1. **Old and new version.** Get the resolved `@vendure/core` version from
   `context.md` step 1. Ask the user which version they upgraded from. Read
   the changelog entries between the two versions, mainly the
   **BREAKING CHANGE** sections:
   https://github.com/vendurehq/vendure/blob/master/CHANGELOG.md
2. **All packages moved.** All `@vendure/*` packages must have the new
   version. Do the checks in `version-mismatch.md`.
3. **Node.js.** Check the version against the supported list.
   Doc: `getting-started/installation#requirements`
4. **doctor.** Run the context doctor command. The CLI guide names upgrade
   verification as a use for `vendure doctor`. It needs v3.7 or later.
   Doc: `developer-guide/cli#the-doctor-command`
5. **TypeScript build.** Ask the user to build the project, or run the build
   script if the user agrees. Compiler errors show changed service APIs used
   by custom plugins.
   Doc: `developer-guide/updating#typescript-api-changes`
6. **GraphQL types.** If the project uses GraphQL code generation, generate
   again. Errors show GraphQL schema changes.
   Doc: `developer-guide/updating#graphql-schema-changes`
7. **Schema changes.** Ask the user for the startup output. A
   `schema does not match` message after an upgrade means the new version
   needs a migration. Go to `migrations.md`.

## Remedies

| Cause                               | Remedy                                                                         | Reference                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ | ------------------------------------------------- |
| Packages not all upgraded           | Set every `@vendure/*` package to the new version, then install                | `developer-guide/updating#how-to-update`          |
| New version needs schema changes    | Back up, `vendure migrate -g <name>`, review, test on non-production data, run | `developer-guide/updating#database-migrations`    |
| Plugin not compatible               | Update the plugin, or see `version-mismatch.md`                                | `cases/version-mismatch.md`                       |
| Compiler errors in custom code      | Fix the code against the changelog entries                                     | `developer-guide/updating#typescript-api-changes` |
| Storefront or plugin GraphQL errors | Generate the GraphQL types again and fix the queries                           | `developer-guide/updating#graphql-schema-changes` |

Never set `synchronize: true` on a production database to apply an upgrade.

## Version-specific notes

Check the `since` version on each reference page. Use a helper only if the
upgrade crosses that version.

| Upgrade crosses | Note                                                                                                                                                                                        | Reference                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| v3.6.0          | `/health` no longer runs `systemOptions.healthChecks` strategies. Remove custom strategies and set `healthChecks: []` to stop the startup warning.                                          | `core-concepts/healthchecks`                                                  |
| v3.6.0          | The asset name moves to a new `asset_translation` table. Call `migrateAssetTranslationData` in the generated migration, after the table is created and before the `name` column is dropped. | `reference/typescript-api/migration/migrate-asset-translation-data`           |
| v3.6.0          | Product option groups become shared. Call `migrateProductOptionGroupData` after the join tables are created and before the `productId` column is dropped.                                   | `reference/typescript-api/migration/migrate-product-option-group-data`        |
| any             | When the generated migration adds unique constraints to translation tables, `vendure migrate` inserts `deduplicateTranslations`. Do not remove it.                                          | `reference/typescript-api/migration/deduplicate-translations`                 |
| v3.7.4          | `runMigrations()` reports `no-migrations-matched` when the migration pattern matches no files.                                                                                              | `reference/typescript-api/migration/migration-diagnostic`                     |
| v3.8.0          | The admin password reset email is a default handler. Set `adminPasswordResetUrl` in `globalTemplateVars`.                                                                                   | `core-concepts/email#email-variables`                                         |
| v3.8.0          | `rescaleOrderLinePromotionAdjustments` corrects promotion adjustments on partly cancelled order lines. It is a one-way data migration.                                                      | `reference/typescript-api/migration/rescale-order-line-promotion-adjustments` |

All references are paths under `https://docs.vendure.io/current/core/`.
