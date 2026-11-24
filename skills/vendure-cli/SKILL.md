---
name: vendure-cli
description: >-
    Use the Vendure CLI (`vendure`) to run, build, migrate, scaffold and check a
    Vendure ecommerce project, and the Developer MCP (`vendure mcp`) for the
    store's admin tools. Use whenever working inside a Vendure project.
allowed-tools: Bash, Read, Edit, Glob, Grep
---

# Vendure CLI

The guide for agents ships with the CLI, so it always matches the installed
version. Run it from the project directory before you use the CLI:

```bash
npx vendure guide
```

Use the project's package manager to run it: `npx vendure`, `pnpm exec vendure`,
`yarn vendure` or `bunx vendure`.

The guide covers running commands with `--json`, answering `incomplete`
results, fixing errors, the dev server, and when to use the Developer MCP
(`vendure mcp`) or the Store MCP (`@vendure/mcp-plugin`).

`vendure commands --json` lists every command of the project, including those
added by plugins. The full reference is in the Vendure docs under
Reference > CLI.
