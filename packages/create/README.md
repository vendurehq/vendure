# Vendure Create

Creates a new Vendure project. The project is a Vendure Cloud app: one `src/vendure-config.ts` that calls `defineCloudConfig()`, with no entry point. Create needs no database and no container runtime. The first `vendure dev` starts local PostgreSQL and Redis in Docker or Podman, writes the initial migration, and seeds the data you chose.

## Usage

Vendure Create requires [Node.js](https://nodejs.org/en/) `>=22.12.0`.

```sh
npx @vendure/create my-shop
```

In a terminal, create asks for each choice. Every choice also has a flag, so agents and scripts can run it without prompts:

```sh
npx @vendure/create my-shop --yes --json
```

Create writes the files, installs the dependencies, writes the agent files, and makes a git repository with an initial commit.

The agent files are:

- `AGENTS.md`, and the Vendure skills in `.agents/skills/`. With Claude Code, also `CLAUDE.md`, `.claude/settings.json` and a copy of the skills in `.claude/skills/`, where Claude Code reads them.
- Each agent client's MCP config, with the `vendure` server (added by `vendure mcp install`) and the `vendure-docs` server.

A client whose config could not be completed is listed in `agentFiles.failed` with the reason. `next` lists `vendure mcp install` for each client that running it again completes. That command changes the committed config, so commit again afterwards. For other failures, the reason says what to do.

Create records your choices in `.vendure/create.json`, which `vendure dev` reads.

## Options

| Option                      | Description                                                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `--storefront <storefront>` | `nextjs`, `tanstack` or `none`. A storefront makes the project a workspace, with the server in `apps/server`.           |
| `--preset <name>`           | The base-data preset the first `vendure dev` seeds, for example `uk`. `vendure seed` lists the presets.                 |
| `--country`, `--currency`   | The options of a preset that takes them, for example `--preset single-country --country NZ --currency NZD`.             |
| `--scenario <name>`         | The demo scenario to seed, or `none`. A scenario sets its own preset, and another `--preset` is refused.                |
| `--features <sets>`         | A comma-separated list of feature sets to install.                                                                      |
| `--package-manager <name>`  | `npm`, `pnpm`, `yarn` or `bun`. The default is the one that ran create, for example `pnpm` for `pnpm dlx`.              |
| `--agents <clients>`        | The agent clients to set the project up for: `claude`, `cursor`, `vscode`, `codex`, or `none`. The default is all four. |
| `-y`, `--yes`               | Accept every default and never prompt.                                                                                  |
| `--json`                    | Print one JSON result on stdout, and everything else on stderr. Never prompts.                                          |
| `--no-install`              | Write the files without installing the dependencies.                                                                    |
| `--no-git`                  | Do not initialise a git repository.                                                                                     |
| `--log-level <level>`       | `silent`, `info` or `verbose`.                                                                                          |

## JSON output

With `--json`, create prints one document on stdout:

```json
{
    "projectDir": "/home/me/my-shop",
    "packageManager": "pnpm",
    "agentFiles": {
        "written": [
            "AGENTS.md",
            ".agents/skills/vendure-cli/",
            ".agents/skills/vendure-store-setup/",
            ".agents/skills/vendure-troubleshooting/",
            "CLAUDE.md",
            ".claude/settings.json",
            ".claude/skills/vendure-cli/",
            ".claude/skills/vendure-store-setup/",
            ".claude/skills/vendure-troubleshooting/",
            ".mcp.json",
            ".cursor/mcp.json",
            ".vscode/mcp.json",
            ".codex/config.toml"
        ],
        "failed": []
    },
    "git": { "status": "committed" },
    "next": ["cd my-shop", "pnpm run dev"]
}
```

`git.status` is `skipped`, with a `reason`, when git is not installed or the directory is already inside a repository. On failure, create exits with a non-zero code and prints `{"error": {"code", "message", "fix"}}`.
