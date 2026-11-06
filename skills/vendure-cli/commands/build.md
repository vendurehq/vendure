# vendure build

Compiles a Vendure project for production: the server and worker are compiled
with the project's own `tsc`, the dashboard with Vite.

## Usage

```bash
vendure build [target]
```

`target` (optional, default `all`): `all` | `server` | `worker` | `dashboard`.

## Options

| Option                     | Description                                                          |
| -------------------------- | -------------------------------------------------------------------- |
| `--tsconfig <path>`        | Server TypeScript config (also used by the worker unless overridden) |
| `--worker-tsconfig <path>` | Separate TypeScript config for the worker                            |
| `--vite-config <path>`     | Vite config used by the dashboard build                              |
| `--experimental-tsgo`      | Deprecated, no effect: the project's own `tsc` is always used        |
| `--clean`                  | Delete build output directories before building                      |
| `--watch`                  | Rebuild on source changes (long-running)                             |
| `--no-progress`            | Disable spinner/progress rendering — use for stable CI logs          |
| `--verbose`                | Show full output from the underlying build tools                     |

## Notes

- Before compiling, the build checks the tsconfig files. If the project compiles
  with TypeScript 7 (recommended), it fails early on options that TypeScript 7
  removed, such as `baseUrl` and `moduleResolution: "node"`. Projects that stay
  on TypeScript 5.x skip those checks; the build logs that it does.
- For CI or scripted builds, prefer `--no-progress` so logs stay parseable, and
  `--verbose` when you need to diagnose a failure.
- `vendure build all` protects overlapping outputs by running the Vite dashboard
  build before TypeScript emits server/worker files. If you manually orchestrate
  Vite and `tsc`, do not run them in parallel when Vite `build.outDir` overlaps
  a TypeScript `outDir`; Vite empties its output directory at build start.
- `--watch` is long-running — do not use it for a one-off build.
- Watch builds must keep processes running in parallel. The CLI disables Vite's
  output-directory emptying for `build all --watch`; custom watch scripts should
  use disjoint output directories or pass Vite `--no-emptyOutDir`.

## Examples

```bash
vendure build                       # build everything
vendure build server --clean        # clean rebuild of just the server
vendure build --no-progress --verbose
```
