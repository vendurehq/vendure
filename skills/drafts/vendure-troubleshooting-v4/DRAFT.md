<!--
Draft for Vendure 4. Not installed as a skill: skill installers look for SKILL.md.

`vendure devserver`, `vendure explain`, `vendure api` and `vendure store check` are not released yet.
When they are, replace the Workflow section of skills/vendure-troubleshooting/SKILL.md with the
workflow below, and delete this file. The frontmatter below is the description the skill gets then.
-->

---
name: vendure-troubleshooting
description: >-
  Find and fix the cause of an error in a local Vendure 4 project. Use when the dev server does not
  start or stops being ready, a GraphQL request fails, or the Dashboard shows an error with a code
  and a request ID. Follows one fixed order: status, logs, explain, doctor, fix, wait, replay.
allowed-tools: Bash, Read, Glob, Grep
---

# Vendure troubleshooting

This skill finds the cause of an error in a local Vendure project, fixes it, and proves the fix.
Use the `vendure-cli` skill to run the CLI with the project's package manager. The examples here use
a bare `vendure …`.

Every Vendure error carries a code, such as `core.entity-with-id-not-found`. An error from a request
also carries the request ID. The code says what failed. The request ID finds the log lines.

## Workflow

Follow these steps in this order. Do not skip a step because you think you know the cause.

1. **`vendure devserver status`.** Is the dev server running and ready? When it stopped on an error,
   the status shows the error's code and its fixes. If it is not running, ask the user to start it.
2. **`vendure devserver logs --min-severity warn`.** Read the recent warnings and errors. Note the
   request ID of each failed request.
3. **`vendure explain <requestId>`.** Collect the error for one request: its code, message, stack
   and the log lines of that request. If the user copied an error with "Copy for agent" in the
   Dashboard, the command is at the end of what they copied.
4. **`vendure doctor --json`.** Check the project itself: versions, config and migrations.
5. **Fix the cause.** Use the fixes that the error or the check names. Ask the user before a fix
   changes files, dependencies or the database. If no fix fits, say so. Do not invent one.
6. **`vendure devserver wait --until ready`.** Wait until the dev server has restarted with the fix.
7. **Replay.** Prove the fix:
   - run the request that failed again with `vendure api admin '<query>'` or
     `vendure api shop '<query>'`;
   - or, for a setup problem such as a missing tax rate or shipping method, run
     `vendure store check`.

   If the replay fails, start again at step 2 with the new request ID.

## Rules for agents

1. **Do not read or send secrets.** Do not open `.env` files, credential files, or files in
   `.vendure/` other than through the commands above.
2. **`vendure api admin` acts as the local superadmin.** Use it to replay a request, not to change
   data the user did not ask you to change.
3. **Do not start long-running processes.** `vendure dev` runs until stopped. Ask the user to start
   it.
