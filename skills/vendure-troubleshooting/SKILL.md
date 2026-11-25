---
name: vendure-troubleshooting
description: >-
  Find and fix the cause of an error in a local Vendure 4 project. Use when
  the dev server does not start or stops being ready, a GraphQL request
  fails, the Dashboard shows an error with a code and a request ID,
  migrations fail, versions do not match, assets or emails do not work, or
  something broke after an upgrade. Follows one fixed order: status, logs,
  explain, doctor, fix, wait, replay.
allowed-tools: Bash, Read, Glob, Grep
---

# Vendure troubleshooting

This skill helps an agent find the cause of a Vendure problem in a local
checkout. It works with the open-source Vendure packages and the Vendure CLI
(`@vendure/cli`). A Vendure Console account or a paid plan is not necessary.

Use the `vendure-cli` skill to build CLI commands. That skill tells you how to
run the CLI with the project's package manager (`bunx`, `pnpm exec`, `yarn`,
`npx`). The examples here use a bare `vendure …`.

## Workflow

Every Vendure error carries a code, such as `core.entity-with-id-not-found`.
An error from a request also carries the request ID. The code says what
failed. The request ID finds the log lines.

Follow these steps in this order. Do not skip a step because you think you
know the cause.

1. **`vendure devserver status`.** Is the dev server running and ready? When
   it stopped on an error, the status shows the error's code and its fixes.
   If the server is not running, ask the user whether to start it. With their
   agreement, run `vendure devserver start`, which starts it in the
   background and waits until it is ready. When it fails without a reason,
   read `.vendure/logs/devserver.log`.
2. **`vendure devserver logs --min-severity warn`.** Read the recent warnings
   and errors. Note the request ID of each failed request.
3. **`vendure explain <requestId>`.** Collect the error for one request: its
   code, message, stack and the log lines of that request. If the user copied
   an error with "Copy for agent" in the Dashboard, the request ID is the
   `requestId` in what they copied. Skip this step when there is no request
   ID, for example when the server does not start.
4. **`vendure doctor --check project dependencies config schema --json`.**
   Check the project itself: versions, config and the schema. Leave out the
   `database` check, as `context.md` says. When the cause is still unclear,
   collect the context in `context.md` and match a support case below. The
   case files were written for Vendure 3.x. Use their checks where they fit
   the project's version.
   Known issue in the 4.0 previews: in a Vendure Cloud app
   (`defineCloudConfig()`), the `config` and `schema` checks fail with
   "Could not find the VendureConfig declaration in your project". A later preview fixes it. Until then, run
   `vendure doctor --check project dependencies --json`, and read config
   errors from `lastError` in `vendure devserver status --json` and from
   `vendure devserver logs`.
5. **Fix the cause.** Use the fixes that the error, the check or the support
   case names. Ask the user before a fix changes files, dependencies or the
   database. If no fix fits, say so. Do not invent one. Ask the user to make
   any change to a `.env` file. Just before a fix that edits a source file,
   read the `restarts` count from `vendure devserver status`.
6. **Wait until the server runs the fix.**
   - After an edit of a `.ts` file in the project's source, or after the user
     changed a `.env` file, run
     `vendure devserver wait --until ready --after-restarts <n>`, where `<n>`
     is the `restarts` count from step 5 plus 1. Without the flag, `wait`
     returns at once when the server was already ready.
   - If that `wait` reports `timedOut: true`, the change did not restart the
     server: for example a `.d.ts` file, a Dashboard extension, a file
     outside the project, or a run started with `--no-reload`. Run
     `vendure devserver status` and ask the user to restart `vendure dev`
     when the fix needs it.
   - A fix that changes no source file, such as installing dependencies or
     running a migration, may not restart the server. Ask the user to restart
     `vendure dev` when it needs to, then run
     `vendure devserver wait --until ready`.
7. **Replay.** Prove the fix:
   - run a failed query again with `vendure api admin '<query>'` or
     `vendure api shop '<query>'`. A mutation changes data again when it is
     replayed. Ask the user before you replay one, and name the data it
     changes;
   - or, for a setup problem such as a missing tax rate or shipping method,
     run `vendure store check`. It reports each finding with a code, such as
     `store.tax.no-rate`, and fixes that name an MCP admin tool of the dev
     server. `vendure mcp` does not offer `store check`; call the McpPlugin's
     `check_store` tool there instead.

   If the replay fails with a request ID, start again at step 3 with it.
   Otherwise, start again at step 1.

## Support cases

| Symptom                                                              | Reference                   |
| -------------------------------------------------------------------- | --------------------------- |
| Server or worker exits at startup, or jobs are never processed       | `cases/startup.md`          |
| Migration fails, is pending, or the schema does not match the config | `cases/migrations.md`       |
| `@vendure/*` versions differ, or a plugin is not compatible          | `cases/version-mismatch.md` |
| Asset upload, preview or URL problems, local or S3 storage           | `cases/assets.md`           |
| Emails are not sent, not received or render wrongly                  | `cases/email.md`            |
| Something broke after an upgrade to the next 3.x minor (4.x: none)   | `cases/upgrade.md`          |

## Docs MCP

The Vendure docs MCP server is `https://docs.vendure.io/mcp`.

| Tool                   | Access                                       |
| ---------------------- | -------------------------------------------- |
| `search_docs`          | Public. No sign-in.                          |
| `get_doc_page`         | Public. No sign-in.                          |
| `get_vendure_workflow` | Vendure Console sign-in and a linked Project |
| `get_vendure_pattern`  | Vendure Console sign-in and a linked Project |

A linked Project does not need a plan or a trial. To get the two gated tools:

1. Run `vendure auth login` to sign in to Vendure Console.
2. Run `vendure console link` in the Vendure project. This writes
   `.vendure/project.json`. When the organization has no Project, create one
   at https://console.vendure.io first. This is free.
3. Add `https://docs.vendure.io/mcp` to the coding assistant. On the first
   gated tool call, sign in and select the Account that owns the linked
   Project.

An unlinked project is a valid state. The public tools and this skill work
without a link. See the CLI guide sections "The Auth Command" and "The Console
Command":
https://docs.vendure.io/current/core/developer-guide/cli#the-console-command

Every doc page this skill cites has the form
`https://docs.vendure.io/current/core/<path>`. Fetch it with `get_doc_page`
when you need the full text.

## Rules for agents

1. **Do not read or send secrets.** Do not open `.env` files, credential
   files, `.vendure/` files other than `project.json` and
   `logs/devserver.log`, or the CLI login file `auth.json`. Read the dev
   server's state and logs only through the `vendure devserver` and
   `vendure explain` commands, and `logs/devserver.log` only when
   `vendure devserver start` fails. Remove host names, user names, tokens and
   connection strings from logs and stacks before you send them to the docs
   MCP or a human. Do not query the database and do not copy database
   contents.
2. **`vendure api admin` acts as the local superadmin.** Use it to replay a
   request, not to change data the user did not ask you to change.
3. **Send context per request only.** The skill stores nothing and uploads
   nothing. Put the context summary in the question you send. Do not save it
   to a file in the project.
4. **Say what you do not know.** When you cannot identify a plugin or a
   version from the files, write "unknown" and the reason. Do not guess.
5. **Do not start long-running processes to check something.** `vendure dev`
   and `vendure start` run until stopped. Ask the user to start them, or to
   give you the startup output. The one exception is
   `vendure devserver start` in step 1, after the user agrees.
6. **Platform packages are optional.** This skill has no guidance for
   commercial Vendure Platform packages. List them in the context like other
   packages. A customer with Platform access can get their gated docs through
   the docs MCP. Do not suggest a purchase as a remedy.
