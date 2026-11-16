# Plugin and `@vendure/*` version mismatches

Applies to: Vendure 3.x. Plugin `compatibility` ranges exist since v2.0.0.
`ignoreCompatibilityErrorsForPlugins` exists since v3.1.0.

## Symptoms

- Startup fails with
  `Plugin "<name>" is not compatible with this version of Vendure.` The
  message names the plugin's semver range and the current version.
- The startup log shows
  `The plugin "<name>" does not specify a compatibility range`. This is
  information, not an error.
- Errors that look like two copies of one library: GraphQL schema errors,
  `instanceof` failures, NestJS injection errors after an install.
- `vendure doctor` reports `Mismatched @vendure/* package versions` or
  `Multiple <package> versions found`.

## Checks

1. **Aligned `@vendure/*` versions.** All `@vendure/*` packages have the same
   version and are released together. Compare the resolved versions from
   `context.md` step 1. The doctor `dependencies` check reports a minor or
   major difference as `fail` and a patch difference as `warn`.
   Doc: `developer-guide/updating#how-to-update`
2. **Duplicate singletons.** The doctor `dependencies` check warns when the
   install has more than one version of `graphql`, `typeorm`, `@nestjs/core`,
   `@nestjs/common`, `@nestjs/graphql`, `@nestjs/typeorm` or `@apollo/server`.
   In a monorepo, a nested copy in another package can be harmless. Check
   which package brings the second copy.
3. **Plugin compatibility.** The doctor `config` check lists each plugin as
   `incompatible (requires <range>, running <version>)` or
   `no compatibility range specified`. Compare the range with the resolved `@vendure/core`
   version.
   Doc: `developer-guide/plugins#step-7-specify-compatibility`
4. **Several lockfiles.** More than one lockfile can install different
   versions than the user expects. The doctor `project` check reports
   `multiple lockfiles found`.
5. **Plugins you cannot identify.** For a local plugin or a plugin from a
   helper function, read its `@VendurePlugin({ compatibility })` value in the
   source, if the source is in the project. Otherwise say that its
   compatibility is unknown.

## Remedies

| Cause                                       | Remedy                                                                                                          | Reference                                              |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `@vendure/*` packages at different versions | Set all `@vendure/*` packages to one version in `package.json`, then install                                    | `developer-guide/updating#how-to-update`               |
| Duplicate singleton dependency              | Align the versions in `package.json`, reinstall, run `vendure doctor --check dependencies`                      | `developer-guide/cli#the-doctor-command`               |
| Third-party plugin not compatible           | Update the plugin to a version whose range includes the current Vendure version                                 | `developer-guide/plugins#step-7-specify-compatibility` |
| Plugin known to work, no release yet        | Add it to `ignoreCompatibilityErrorsForPlugins` in the `bootstrap()` options (v3.1.0+). Tell the user the risk. | `reference/typescript-api/common/bootstrap`            |
| Local plugin range too narrow               | Update the `compatibility` range in the local plugin's metadata                                                 | `developer-guide/plugins#step-7-specify-compatibility` |
| Several lockfiles                           | Keep the lockfile of the package manager the project uses                                                       | `skills/vendure-cli/SKILL.md` ("Running the CLI")      |

After a remedy, run `vendure doctor --check dependencies config` again.

All references are paths under `https://docs.vendure.io/current/core/`, or
files in this repository's `skills/` directory.
