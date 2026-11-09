# TypeORM version test harness

Vendure supports both TypeORM v0.3 and v1 from the same source. v1 is the default: it is what
the committed lockfile installs and what new projects get, while the `typeorm` range in
`@vendure/core` (`^0.3.21 || ^1.1.2`) still admits v0.3 so that existing projects can stay on it.
These scripts run the database-backed test suites against
either version.

## Why the version has to be forced

`typeorm` is a direct dependency of `@vendure/core`, not a peer dependency, so you cannot pick
the version at install time. Instead, each profile in `profiles.json` is written into the root
`package.json` as a set of `overrides`, which bun applies to workspace packages' direct
dependencies. The root already uses the same mechanism to keep `graphql` on one version.

A profile covers more than `typeorm` itself. TypeORM v1 requires `@nestjs/typeorm` 11.0.1 or
later (earlier releases declare a `typeorm` peer range of `^0.3.0`) and `better-sqlite3` v12.

## Running the suites

```sh
# Switch the workspace to TypeORM v0.3 and install (v1 is the default install)
bun run typeorm:use 0.3

# Run the unit and e2e suites against whichever profile is active
bun run test:db                  # sqljs
DB=postgres bun run test:db      # postgres
bun run test:db --e2e-only
bun run test:db --scope @vendure/core

# Go back to the versions declared in the workspace
bun run typeorm:use --reset
```

`bun run typeorm:use` rewrites `package.json` and `bun.lock`. Run `--reset` before committing;
a stray `typeormProfile` field in the root `package.json` is the tell that you forgot.

Applying a profile saves a copy of `bun.lock` first, and `--reset` puts it back and installs
frozen. Without that, the reset install would float every dependency to the newest version its
declared range allows, leaving the workspace on different versions from the ones it started on.

`test:db` verifies the install before running anything. Entity metadata is registered against a
single `typeorm` module instance, so a second copy nested somewhere in `node_modules` makes the
suites fail in ways that read like genuine version incompatibilities. `bun run typeorm:verify`
runs the same check on its own.

## Building while type errors remain

```sh
bun run build:for-tests
```

When a package stops typechecking against a TypeORM version, `bun run build` stops at the first
error. `@vendure/core` builds in three stages joined by `&&` — the main compile, the CLI
compile, and a copy of the static `.graphql` schema files — so one type error leaves `dist/`
without the schema files and the server then fails to boot with "No type definitions were
found", which tells you nothing about the actual incompatibility.

`build:for-tests` runs each stage separately and keeps going. `tsc` emits its output even when
it reports errors, so everything needed to boot a server is produced. The `build` jobs in
`build_and_test.yml` and `typeorm_v0_3.yml` still compile strictly and report the type errors, so the e2e jobs are free
to report what fails once the code is running.

## In CI

The `.github/actions/setup` action takes a `typeorm` input naming a profile. With no input it
installs the committed lockfile, which is what `build_and_test.yml` does and what gives the
project its v1 coverage.

The v0.3 runs live in `typeorm_v0_3.yml`, kept separate from `build_and_test.yml` so that the
second TypeORM version does not double the cost of every pull request. They run on every pull
request into `major` and on every push to it, and on demand.

To make a v0.3 break block merges into `major`, mark the workflow's jobs (build, unit tests and
the e2e jobs) as required status checks in the branch protection rules for `major`.

The v0.3 jobs cover one database per TypeORM dialect family — postgres, mariadb and sqljs. mysql
is left out because it goes through the same TypeORM driver as mariadb, so it would repeat that
coverage rather than add to it. The full four-database matrix runs on v1 in
`build_and_test.yml`.

## Adding a version

Add an entry to `profiles.json` naming every package that has to move together with that
TypeORM version. `use-version.mjs` clears the packages named by _all_ profiles before applying
the requested one, so switching between profiles never leaves a stale override behind.
