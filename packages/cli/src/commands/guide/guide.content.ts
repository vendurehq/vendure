/**
 * The agent guide that `vendure guide` prints. It ships with the CLI, so it always matches the
 * commands of the installed version. The `vendure-cli` skill points here.
 */
export const AGENT_GUIDE = `# Working with the Vendure CLI as an agent

The Vendure CLI (\`vendure\`, from \`@vendure/cli\`) runs, builds, migrates and scaffolds a Vendure
project. Run it from the project directory with the project's package manager:
\`npx vendure\`, \`pnpm exec vendure\`, \`yarn vendure\` or \`bunx vendure\`.

## Find the commands

- \`vendure commands --json\` lists every command of this project, including those added by
  plugins, with its behavior and the JSON Schema of its input and output.
- \`vendure <command> --help\` shows the flags of one command.

## Run commands with --json

Add \`--json\` to any command. It writes exactly one JSON document to stdout:

\`\`\`json
{ "schemaVersion": 1, "status": "ok", "output": {}, "notices": [] }
\`\`\`

- \`status\` is \`ok\`, \`failed\` (the command ran and its checks failed), \`incomplete\` or
  \`error\`. The exit code is 0 for \`ok\`, 3 for \`incomplete\` and 1 otherwise.
- Read \`notices\`. They hold what a person must know, such as the ID of a safety backup.
- Progress events and library output go to stderr. Lines tagged \`"vendure": "event"\` are events.
- Pass the whole input as JSON with \`--input '<json>'\`, or \`--input -\` to read it from stdin.
- Without a TTY, or with \`CI\` or \`VENDURE_CLI_NON_INTERACTIVE\` set, the CLI never prompts.

## Answer an incomplete result

\`incomplete\` means the command needs something before it can finish. Supply every item in
\`needs\`, then run the same command again:

- \`input\`: a missing input field. \`choices\` lists the valid values when there are any.
- \`consent\`: a named consent for a risky step. Show the \`preview\` to the person you work for,
  and pass the \`digest\` as the value of the field named by \`consent\`, for example
  \`--revert-migration <digest>\`. A digest only answers the preview it came with.
- \`person\`: a step only a person may take. Give them the \`url\`.

## Fix errors

An \`error\` result has a namespaced \`code\`, a \`message\` and \`fixes\`. A fix with a \`path\` and
an \`input\` is a command: run \`vendure <path…>\` with that input. Otherwise follow its
\`description\`.

## The dev server

Use the \`devserver\` commands, not the foreground \`vendure dev\`, which never returns:

- \`vendure devserver start --json\` starts it in the background and returns when it is ready.
- \`vendure devserver status --json\` shows its status, URLs and last error.
- \`vendure devserver wait --json\` waits until it is ready again after a change.
- \`vendure devserver logs --since 5m --json\` reads its logs. \`vendure devserver stop\` stops it.

After you change an entity, run \`vendure migrate generate\`, then \`vendure migrate run\`.
\`vendure doctor --json\` checks the project's setup.

## The Developer MCP and the Store MCP

- The **Developer MCP** is \`vendure mcp\`. It offers the commands of this CLI as MCP tools, and
  the admin tools of the running dev server as \`admin_*\` tools. Add it to a client with
  \`vendure mcp install --client <claude|cursor|vscode|codex>\`.
- The **Store MCP** is the MCP server of \`@vendure/mcp-plugin\`, inside a running Vendure server,
  local or deployed. Its tools work with the store's data: products, orders, customers, channels,
  tax and shipping setup, and a store check.

Working on the code, use the Developer MCP. Working with a running store, use the Store MCP.

If you have a shell, run CLI commands with \`--json\`: you get the same commands, results and
errors as the MCP tools, without their tool descriptions in your context. Use \`vendure mcp\` for
the \`admin_*\` tools. Without a shell, use \`vendure mcp\` for everything.

## The admin_* tools

- They act as the superadmin of the local dev server, and are listed only while it is running.
  When it stops or starts, the tool list changes. A call while it is stopped returns an error
  whose fix starts it.
- In the default discovery mode, find tools with \`search_tools\`, then run each one with the
  executor of its behavior: \`execute_readonly\`, \`execute_mutating\` or \`execute_destructive\`.
- A destructive tool first returns an \`incomplete\` result with a preview and a consent digest.
  Call it again with \`confirm\` set to that digest.
- \`admin_set_active_channel\` selects the channel for the later calls of the session.
`;
