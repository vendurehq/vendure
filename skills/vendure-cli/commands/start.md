# vendure start

Runs a project that has already been compiled with `vendure build`.

## Usage

```bash
vendure start [target]
```

`target` (optional, default `all`): `all` | `server` | `worker`.

There is **no `dashboard` target** — the dashboard is built to static assets
and served by the server.

## Options

| Option                  | Description                            |
| ----------------------- | -------------------------------------- |
| `--server-entry <path>` | Path to the compiled server entry file |
| `--worker-entry <path>` | Path to the compiled worker entry file |

## Notes

- Run `vendure build` first. `start` does not compile anything; it runs the
  already-compiled output.
- For production-only installs where dev dependencies are pruned, do not rely on
  `vendure start` unless `@vendure/cli` is installed as a production dependency.
  Use the compiled entrypoints directly instead:
  `node ./dist/index.js` for the server and `node ./dist/index-worker.js` for
  the worker.
- `vendure start all` starts server and worker together. If either child exits,
  the CLI terminates the sibling and waits for it to close so graceful shutdown
  hooks can complete.
- This is a **long-running process** — run it only when the user asks, and
  prefer the background.

## Examples

```bash
vendure build && vendure start   # build then run
vendure start worker                 # run just the worker
node ./dist/index.js                 # production server without the CLI
```
