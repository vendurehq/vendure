---
name: vendure-troubleshooting
description: >-
  Find and fix the cause of an error in a local Vendure 4 project. Use when the dev server does not
  start or stops being ready, a GraphQL request fails, the Dashboard shows an error with a code and a
  request ID, migrations fail, versions do not match, or assets or emails do not work. Follows one
  fixed order: status, logs, explain, doctor, fix, wait, replay.
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

Every Vendure error carries a code, such as `core.entity-with-id-not-found`. An error from a request
also carries the request ID. The code says what failed. The request ID finds the log lines.

Follow these steps in this order. Do not skip a step because you think you know the cause.

1. **`vendure devserver status`.** Is the dev server running and ready? When it stopped on an error,
   the status shows the error's code and its fixes. If it is not running, ask the user to start it.
2. **`vendure devserver logs --min-severity warn`.** Read the recent warnings and errors. Note the
   request ID of each failed request.
3. **`vendure explain <requestId>`.** Collect the error for one request: its code, message, stack
   and the log lines of that request. If the user copied an error with "Copy for agent" in the
   Dashboard, the request ID is the `requestId` in what they copied.
4. **`vendure doctor --json`.** Check the project itself: versions, config and migrations. When
   the cause is still unclear, collect the context in `context.md` and match a support case below.
5. **Fix the cause.** Use the fixes that the error, the check or the support case names. Ask the
   user before a fix changes files, dependencies or the database. If no fix fits, say so. Do not
   invent one.
6. **`vendure devserver wait --until ready`.** Wait until the dev server has restarted with the fix.
7. **Replay.** Prove the fix:
   - run the request that failed again with `vendure api admin '<query>'` or
     `vendure api shop '<query>'`;
   - or, for a setup problem such as a missing tax rate or shipping method, run
     `vendure store check`.

   If the replay fails, start again at step 2 with the new request ID.

## Support cases

| Symptom                                                              | Reference                   |
| -------------------------------------------------------------------- | --------------------------- |
| Server or worker exits at startup, or jobs are never processed       | `cases/startup.md`          |
| Migration fails, is pending, or the schema does not match the config | `cases/migrations.md`       |
| `@vendure/*` versions differ, or a plugin is not compatible          | `cases/version-mismatch.md` |
| Asset upload, preview or URL problems, local or S3 storage           | `cases/assets.md`           |
| Emails are not sent, not received or render wrongly                  | `cases/email.md`            |
| Something broke after an upgrade to the next 3.x minor               | `cases/upgrade.md`          |

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
   files, `.vendure/` files other than `project.json`, or the CLI login file
   `auth.json`. Read the dev server's state and logs only through the
   `vendure devserver` and `vendure explain` commands. Do not query the
   database and do not copy database contents.
2. **`vendure api admin` acts as the local superadmin.** Use it to replay a
   request, not to change data the user did not ask you to change.
3. **Send context per request only.** The skill stores nothing and uploads
   nothing. Put the context summary in the question you send. Do not save it
   to a file in the project.
4. **Say what you do not know.** When you cannot identify a plugin or a
   version from the files, write "unknown" and the reason. Do not guess.
5. **Do not start long-running processes to check something.** `vendure dev`
   and `vendure start` run until stopped. Ask the user to start them, or to
   give you the startup output.
6. **Platform packages are optional.** This skill has no guidance for
   commercial Vendure Platform packages. List them in the context like other
   packages. A customer with Platform access can get their gated docs through
   the docs MCP. Do not suggest a purchase as a remedy.
