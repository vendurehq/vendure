import { MCP_CLIENTS } from '../mcp/install/client-config.js';

/**
 * The agent guide that `vendure guide` prints. It ships with the CLI, so it always matches the
 * commands of the installed version. The `vendure-cli` skill points here.
 */
export const AGENT_GUIDE = `# Working with the Vendure CLI as an agent

The Vendure CLI (\`vendure\`, from \`@vendure/cli\`) runs, builds, migrates and scaffolds a Vendure
project. Run it from the project directory with the runner of the project's package manager, so
you get the project's own CLI version: \`bunx vendure\` with \`bun.lock\` or \`bun.lockb\`,
\`pnpm exec vendure\` with \`pnpm-lock.yaml\`, \`yarn vendure\` with \`yarn.lock\`, and \`npx vendure\` with
\`package-lock.json\` or with no lockfile.

## Find the commands

- \`vendure commands --json\` lists the commands that accept \`--json\`, including those added by
  plugins, with their behavior and the JSON Schema of their input and output.
- \`vendure --help\` lists every command, and \`vendure <command> --help\` shows the flags of one.

## Run commands with --json

The commands that \`vendure commands --json\` lists accept \`--json\`. With it, a command writes
exactly one JSON document to stdout:

\`\`\`json
{ "schemaVersion": 1, "status": "ok", "output": {}, "notices": [] }
\`\`\`

- \`status\` is \`ok\`, \`failed\` (the command ran and its checks failed), \`incomplete\` or
  \`error\`. The exit code is 0 for \`ok\`, 3 for \`incomplete\`, and 1 or more for \`failed\` and
  \`error\`.
- Read \`notices\`. They hold what a person must know, such as the ID of a safety backup.
- Progress events and library output go to stderr. Lines tagged \`"vendure": "event"\` are events.
- Pass the whole input as JSON with \`--input '<json>'\`, or \`--input -\` to read it from stdin.
- Without a TTY, or with \`CI\` or \`VENDURE_CLI_NON_INTERACTIVE\` set, these commands never prompt.
  A missing input returns \`incomplete\` at once.
- Other commands, such as \`vendure dev\`, \`build\` and \`start\`, have no \`--json\`. Run
  \`vendure <command> --help\` for their options.

## Answer an incomplete result

\`incomplete\` means the command needs something before it can finish. Supply every item in
\`needs\`, then run the same command again:

- \`input\`: a missing input field. \`choices\` lists the valid values when there are any. When
  the need has \`secret: true\`, the value must not pass through you: ask the person you work for
  to supply it.
- \`consent\`: a named consent for a risky step. Show the \`preview\` to the person you work for,
  and pass the \`digest\` as the value of the field named by \`consent\`, for example
  \`--revert-migration <digest>\`. A digest only answers the preview it came with.
- \`person\`: a step only a person may take. Give them the \`url\`.

## Fix errors

An \`error\` result has a namespaced \`code\`, a \`message\` and \`fixes\`. Each fix is a command:
run \`vendure <path…>\` with its \`input\`. Its \`description\` says why. A need can carry a \`fix\`
of the same shape.

## The dev server

Use the \`devserver\` commands, not the foreground \`vendure dev\`, which never returns:

- \`vendure devserver start --json\` starts it in the background and returns when it is ready.
  Over \`vendure mcp\` it returns once the run has started: then call \`devserver_wait\`.
- \`vendure devserver status --json\` shows its status, URLs and last error.
- After you edit server code, the dev server restarts. Read \`restarts\` from
  \`vendure devserver status --json\` before the edit, then run
  \`vendure devserver wait --after-restarts <restarts + 1> --json\`. Without \`--after-restarts\`, it
  returns at once while the old run is still ready.
- \`vendure devserver logs --since 5m --json\` reads its logs. \`vendure devserver stop\` stops it.

After you change an entity, run \`vendure migrate generate <name>\`. In a Vendure Cloud project,
\`vendure dev\` applies pending migrations only when it starts, so run \`vendure devserver stop\`,
then \`vendure devserver start --json\`. Otherwise run \`vendure migrate run\`.
\`vendure doctor --json\` checks the project's setup.

## The Developer MCP and the Store MCP

- The **Developer MCP** is \`vendure mcp\`. It offers the commands of this CLI as MCP tools, and
  the admin tools of the project's running dev server as \`admin_*\` tools. Add it to a client
  with \`vendure mcp install --client <${MCP_CLIENTS.join('|')}>\`.
- The **Store MCP** is the MCP server of \`@vendure/mcp-plugin\`, inside a running Vendure server,
  local or deployed. Its tools work with the store's data: products, orders, customers, channels,
  tax and shipping setup, and a store check.

Working on the code, use the Developer MCP. Working with a running store, use the Store MCP.

If you have a shell, run CLI commands with \`--json\`: you get the same commands, results and
errors as the MCP tools, without their tool descriptions in your context. Use \`vendure mcp\` for
the \`admin_*\` tools. Without a shell, use \`vendure mcp\` for everything. In its default
discovery mode, find a tool with \`search_tools\`, then run it with the executor of its behavior:
\`execute_readonly\`, \`execute_mutating\` or \`execute_destructive\`.

## The admin_* tools

- They are the Store MCP's admin tools of the dev server that \`vendure dev\` or
  \`vendure devserver start\` runs for the project, and they act as its superadmin. They need the
  \`McpPlugin\` in the project's config, with its \`localTrust\` option left on.
- They are listed only while that dev server is ready. When it starts or stops, the Developer MCP
  tells the client that its tool list changed. A call while it is stopped, starting or failed
  returns an error whose fix is a command such as \`devserver_start\` or \`devserver_wait\`.
- A destructive tool first returns an \`incomplete\` result with a preview and a consent digest.
  Show the preview to the person you work for, then call the tool again with \`confirm\` set to
  the digest, inside \`input\` when you call it through an executor.
- \`admin_set_active_channel\` selects the channel for the later calls of the same MCP connection.
  Without it, the tools act on the default channel.
- If a write fails with a notice that it may still have run, check its effect with a read-only
  tool before you call it again.

`;
