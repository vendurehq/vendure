---
name: vendure-cli
description: >-
  Use the Vendure CLI (`vendure`) to scaffold, run, build, migrate and
  maintain a Vendure ecommerce project. Use whenever working inside a Vendure
  project that needs a dev server, a production build, database migrations,
  plugin/entity/service scaffolding, GraphQL schema generation, or codemods.
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# Vendure CLI

The Vendure CLI (`@vendure/cli`, binary `vendure`) drives the full lifecycle of
a Vendure project. Use it instead of hand-writing boilerplate or guessing build
and migration commands.

## Detecting a Vendure project

Run CLI commands from a Vendure server package root, or from a monorepo root
that contains a Vendure package under `packages/`, `apps/`, `libs/`,
`services/`, or `modules/`.

`dev`, `build`, and `start` resolve the project directory from the current
working directory if it contains `@vendure/core`, or by scanning those monorepo
package directories. `add`, `migrate`, and `schema` analyze the TypeScript
project from `process.cwd()` and require a `tsconfig*.json` there, so do not
assume they work from arbitrary nested subdirectories.

## Running the CLI

`@vendure/cli` is normally a project dependency, so run it through the
project's package manager — do **not** assume `npx`. Detect the package
manager from the lockfile in the project root or workspace root and use the
matching runner:

| Lockfile in project root | Package manager | Run the CLI with              |
| ------------------------ | --------------- | ----------------------------- |
| `bun.lock` / `bun.lockb` | bun             | `bunx vendure <command>`      |
| `pnpm-lock.yaml`         | pnpm            | `pnpm exec vendure <command>` |
| `yarn.lock`              | yarn            | `yarn vendure <command>`      |
| `package-lock.json`      | npm             | `npx vendure <command>`       |
| none found               | npm (fallback)  | `npx vendure <command>`       |

If `@vendure/cli` is installed globally, call `vendure <command>` directly.
List all commands with `vendure --help`.

The `commands/*.md` reference files write examples with a bare `vendure …` —
prefix each one with the runner for the detected package manager.

Note: CLI scaffolding that installs packages currently detects `yarn.lock`,
`package-lock.json`, and `pnpm-lock.yaml` internally, then falls back to npm.
It does not use Bun for those generated dependency installs.

## Commands

| Command   | Use it to…                                              | Reference             |
| --------- | ------------------------------------------------------- | --------------------- |
| `dev`     | Run server + worker + dashboard in development mode     | `commands/dev.md`     |
| `build`   | Compile the project for production                      | `commands/build.md`   |
| `start`   | Run an already-built project                            | `commands/start.md`   |
| `add`     | Scaffold a plugin, entity, service, API extension, etc. | `commands/add.md`     |
| `migrate` | Generate, run or revert database migrations             | `commands/migrate.md` |
| `schema`  | Generate a GraphQL schema file from the Admin/Shop API  | `commands/schema.md`  |
| `codemod` | Run automated code transforms (e.g. UI migrations)      | `commands/codemod.md` |

## Critical rules for agents

1. **Never hardcode `npx`.** Resolve the runner from the project's lockfile —
   see "Running the CLI" above (`bunx`, `pnpm exec`, `yarn`, `npx`).
2. **Prompt-capable commands (`add`, `migrate`, `schema`, `codemod`) need
   explicit flags/arguments from agents.** Run them with explicit inputs so they
   take the non-interactive path; otherwise the process rejects prompt-only
   invocations in non-interactive environments. Set
   `VENDURE_CLI_NON_INTERACTIVE=true` when calling the CLI from an agent so
   prompt-only invocations fail fast with examples instead of waiting on a
   terminal prompt. The exact non-interactive flags are in each command's
   reference file.
3. **`dev`, `start`, and `build --watch` are long-running processes.** Do not
   run them just to "check" something. Run them only when the user asks, and
   prefer running them in the background.
4. **Production-only installs may not include `@vendure/cli`.** Generated apps
   keep the CLI as a dev dependency, so after pruning dev dependencies, start
   compiled server/worker entrypoints with `node ./dist/...` or make the CLI a
   production dependency explicitly.
5. **Read the relevant `commands/*.md` file before building a command.** Valid
   targets and flags differ per command (e.g. `start` has no `dashboard`
   target; `--inspect` only applies to `dev`).
