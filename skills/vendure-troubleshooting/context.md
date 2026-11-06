# Collect the project context

Collect this context before you ask the docs MCP or a human for help. All
steps read local files or run static checks. Do not start the server or the
worker, and do not connect to the database.

Run the steps from the Vendure project root: the directory whose
`package.json` has `@vendure/core`. In a monorepo, the lockfile is usually in
the workspace root.

## What you must not read or send

- `.env`, `.env.*` and other files that hold environment values
- Credential and key files, and the CLI login file `auth.json`
  (`~/.config/vendure` or `VENDURE_CLI_CONFIG_DIR`)
- Files in `.vendure/` other than `project.json`
- Database contents. Do not run queries.
- Logs and stack traces, unless the user gives them to you. Remove host
  names, user names, tokens and connection strings before you send them.
- Values from `vendure-config.ts`. You can read the file to find plugin class
  names, but do not copy option values. The file can contain inline secrets.

## 1. Vendure versions

1. Read `package.json`. Write down the version range of each `@vendure/*`
   dependency (`dependencies`, `devDependencies`, `optionalDependencies`).
2. Find the resolved version in the lockfile:

   | Lockfile            | Where the resolved version is                                                                           |
   | ------------------- | ------------------------------------------------------------------------------------------------------- |
   | `package-lock.json` | `packages["node_modules/@vendure/core"].version`                                                        |
   | `pnpm-lock.yaml`    | `importers` → project path (`.` for the root) → `dependencies` → `version`. Ignore a `(…)` peer suffix. |
   | `yarn.lock`         | The `version` line under the `"@vendure/core@…"` entry                                                  |
   | `bun.lock`          | `packages["@vendure/core"]`: the first array item is `@vendure/core@<version>`                          |
   | `bun.lockb`         | Binary. Do not parse it. Use step 3.                                                                    |

3. If the lockfile does not answer, read the `version` field of
   `node_modules/@vendure/core/package.json`. Say which source you used.
4. More than one lockfile is a finding. Report all of them.

All `@vendure/*` packages share one version number. A difference between them
is a finding for `cases/version-mismatch.md`.

## 2. Plugin inventory

1. From `package.json`, list each dependency that is a Vendure plugin: a
   `@vendure/*-plugin` package, or a package whose name or description refers
   to Vendure. Write down the resolved version from the lockfile.
2. Read the `plugins` array in the Vendure config (usually
   `src/vendure-config.ts`). For each entry, find the import:
   - Import from a package: link the class name to that package.
   - Import from a relative path (`./plugins/…`): mark it as a local plugin.
     A local plugin has no package version.
   - The class comes from a helper, a spread array, or a condition (for
     example `...getPlugins()` or `IS_DEV ? [...] : [...]`): mark it as
     "not identified statically".
3. Do not guess a version or a source. Write "unknown" and the reason.

## 3. Console link

Read `.vendure/project.json` in the Vendure project root, if it exists. You
can also run `vendure console status`. It reads local state only and does not
contact Vendure Console.

| State    | How to tell                                                      | What to record                                |
| -------- | ---------------------------------------------------------------- | --------------------------------------------- |
| Unlinked | The file does not exist                                          | `unlinked`. This is a valid state.            |
| Linked   | Valid JSON with `schemaVersion: 1`, `project`, `account`, `link` | `linked`, project name, account name          |
| Invalid  | The file is not valid JSON or has other fields                   | `invalid`. `vendure console link` repairs it. |

The file has this shape. The `console` block is optional.

```json
{
  "schemaVersion": 1,
  "project": { "id": "<uuid>", "name": "<display name>" },
  "account": { "id": "<uuid>", "name": "<display name>" },
  "link": { "id": "<uuid>", "protocolVersion": 1 },
  "console": { "appOrigin": "https://console.vendure.io", "apiOrigin": "https://api.vendure.io" }
}
```

Use the account name to tell the user which Account to select when the docs
MCP asks them to sign in. Send only `linked`, `unlinked` or `invalid` to the
docs MCP. Do not send the IDs or names.

## 4. Runtime and tools

- Node.js: `node --version`. Vendure supports Node.js v20, v22 and v24.
- Package manager: the `packageManager` field in `package.json`, then
  `<manager> --version`.

## 5. vendure doctor

`vendure doctor` exists in `@vendure/cli` v3.7 and later. For an older
project, skip this step and record "doctor not available".

Run the static checks only:

```bash
vendure doctor --check project dependencies config schema --format json
```

Do not include the `database` check in the context step. It connects to the
database. Run it only when a support case needs it and the user agrees.

Notes:

- The `config` check loads the Vendure config the same way the CLI does. This
  loads `.env` into the doctor process. You do not read the file, but error
  text in `details` can contain values. Remove host names, user names,
  passwords, tokens and connection strings before you send the report.
- The report has `vendureVersion`, `nodeVersion`, `packageManager`, `checks`
  and `overallStatus`. Each check has `status` `pass`, `warn`, `fail` or
  `skip`. A failed `project` check skips all later checks. A failed `config`
  check skips `schema`.
- The command exits with code 1 when `overallStatus` is `failed`. This is a
  result, not a tool error.

See `skills/vendure-cli/commands/doctor.md` and
https://docs.vendure.io/current/core/developer-guide/cli#the-doctor-command

## 6. Context summary

Write the summary in this format. Show it to the user before you send it.
Send it with each question to the docs MCP or a human. Do not store it.

```text
Vendure context (collected locally for this question)
- @vendure/core: 3.7.4 (range ^3.7.0, source: pnpm-lock.yaml)
- Other @vendure/* packages: all 3.7.4
- Plugins:
  - @vendure/email-plugin 3.7.4
  - @vendure/asset-server-plugin 3.7.4
  - vendure-plugin-example 1.2.0
  - ReviewsPlugin: local plugin (./src/plugins/reviews), no package version
  - Unknown: plugins added by getPlugins(), not identified statically
- Node.js: v22.11.0; package manager: pnpm 9.12.0; lockfiles: pnpm-lock.yaml
- Console link: linked
- vendure doctor: failed
  - Dependencies: fail. Mismatched @vendure/* package versions (minor/major)
  - Config: warn. 1 plugin(s) without compatibility range
  - Schema: pass
- Symptom: <the user's words>
```

When you use the docs MCP, put the summary and the symptom in the `context`
parameter of `search_docs` or `get_doc_page`.
