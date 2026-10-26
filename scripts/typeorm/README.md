# TypeORM version test harness

Vendure supports both TypeORM v0.3 and v1 from the same source, so that existing projects can
stay on v0.3 while new ones adopt v1. These scripts run the database-backed test suites against
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
# Switch the workspace to TypeORM v1 and install
bun run typeorm:use 1

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
it reports errors, so everything needed to boot a server is produced. The `build` job in
`typeorm_v1.yml` still compiles strictly and reports the type errors, so the e2e jobs are free
to report what fails once the code is running.

## In CI

The `.github/actions/setup` action takes a `typeorm` input naming a profile. With no input it
installs the committed lockfile, which is what `build_and_test.yml` does and what gives the
project its v0.3 coverage.

The v1 runs live in `typeorm_v1.yml`, kept separate from `build_and_test.yml` so that the
second TypeORM version does not double the cost of every pull request. They run after a merge
to `master`, `minor` or `major`, on demand, and when the `typeorm-v1` label is added to a pull
request. Add that label to work touching entities, repositories, migrations or query building,
where a version difference is most likely to show. Adding the label is the only pull request
trigger, so pushing further commits does not produce a new result; remove and re-add the label
when you want one.

The v1 jobs cover one database per TypeORM dialect family — postgres, mariadb and sqljs. mysql
is left out because it goes through the same TypeORM driver as mariadb, so it would repeat that
coverage rather than add to it. The full four-database matrix stays on v0.3 in
`build_and_test.yml`.

## Adding a version

Add an entry to `profiles.json` naming every package that has to move together with that
TypeORM version. `use-version.mjs` clears the packages named by _all_ profiles before applying
the requested one, so switching between profiles never leaves a stale override behind.
