# vendure dev

Runs Vendure in development mode. By default it starts three processes: the
GraphQL **server** (`ts-node ./src/index.ts`), the **worker**
(`ts-node ./src/index-worker.ts`), and the **dashboard** (a Vite dev server).

## Usage

```bash
vendure dev [target]
```

`target` (optional, default `all`): `all` | `server` | `worker` | `dashboard`.

## Options

| Option                      | Description                                                      |
| --------------------------- | ---------------------------------------------------------------- |
| `--server-entry <path>`     | Server entry file (default `./src/index.ts`)                     |
| `--worker-entry <path>`     | Worker entry file (default `./src/index-worker.ts`)              |
| `--vite-config <path>`      | Vite config file used by the dashboard                           |
| `--inspect [host:port]`     | Enable the Node.js inspector for server/worker                   |
| `--inspect-brk [host:port]` | Enable the inspector and break before user code starts           |
| `--no-reload`               | Disable automatic server/worker restarts on backend file changes |

## Notes

- `--inspect` and `--inspect-brk` cannot be combined, and apply only to the
  `server` and `worker` targets — not `dashboard`.
- With `dev all` and `--inspect`, the server inspector listens on `9229` and
  the worker on `9230`.
- The server and worker targets need `./src/index.ts` and
  `./src/index-worker.ts` to exist (or paths supplied via the entry options).
- By default, server and worker restart when backend source files or `.env`
  files change. Dashboard extension directories declared in plugin metadata are
  ignored because Vite handles those updates.
- Use `--no-reload` when restart supervision is undesirable, for example when
  another watcher already controls the server process.
- This is a **long-running process**. Run it in the background and only when
  the user explicitly asks for a dev server.

## Examples

```bash
vendure dev                       # server + worker + dashboard
vendure dev server                # just the GraphQL server
vendure dev server --inspect-brk  # debug the server, break on start
vendure dev all --no-reload       # no automatic backend restarts
```
