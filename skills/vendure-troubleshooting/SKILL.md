---
name: vendure-troubleshooting
description: >-
  Diagnose a broken or misbehaving Vendure project. Use when a Vendure server
  or worker does not start, migrations fail or are pending, `@vendure/*` or
  plugin versions do not match, assets or emails do not work, or an upgrade
  to the next 3.x minor breaks something. Collects local project context
  first, then follows the matching support case and the public Vendure docs.
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

1. **Collect the context.** Follow `context.md` before you ask the docs MCP
   or a human. The context step reads files and runs static checks only. It
   does not start the application and does not connect to the database.
2. **Match the support case.** Compare the user's symptoms and the context
   with the cases below. Read the matching file. More than one case can apply.
3. **Do the checks in the case file** in the given order. Stop when a check
   finds the cause.
4. **Apply a remedy only with the user's approval** when it changes files,
   dependencies or the database. Each remedy names a CLI command or a doc page.
   If no remedy fits, say so. Do not invent one.
5. **Ask the docs MCP** when the case files do not answer the question. Send
   the context summary from `context.md` with the question.

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
   `auth.json`. Do not query the database and do not copy database contents.
   Read logs only when the user gives them to you.
2. **Send context per request only.** The skill stores nothing and uploads
   nothing. Put the context summary in the question you send. Do not save it
   to a file in the project.
3. **Say what you do not know.** When you cannot identify a plugin or a
   version from the files, write "unknown" and the reason. Do not guess.
4. **Do not start long-running processes to check something.** `vendure dev`
   and `vendure start` run until stopped. Ask the user to start them, or to
   give you the startup output.
5. **Platform packages are optional.** This skill has no guidance for
   commercial Vendure Platform packages. List them in the context like other
   packages. A customer with Platform access can get their gated docs through
   the docs MCP. Do not suggest a purchase as a remedy.
