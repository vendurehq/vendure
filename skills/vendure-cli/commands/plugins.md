# `vendure plugins`

List, enable, or disable CLI plugins for the current project.

CLI plugins are discovered from direct dependencies that declare
`vendure.cliPlugin`, but they are **not loaded** until listed in
`package.json` → `vendure.cli.plugins`.

## Usage

```bash
# Interactive multiselect (TTY only)
vendure plugins

# Machine-readable status (never prompts)
vendure plugins --json

# Enable / disable without prompts
vendure plugins add @vendure/cloud
vendure plugins remove @vendure/cloud
```

## Agent notes

- Prefer `vendure plugins --json`, `add`, and `remove` — never rely on the
  interactive multiselect.
- `--json` combined with `add`/`remove` performs the write first, then prints
  the updated state.
- There is **no** blanket-approve flag. Enable packages individually.
- `remove` deletes the package from `vendure.cli.plugins`; removing a package
  that is not enabled is an error (exit 1), not a silent no-op.
- Enabling a package fails if it is not a direct dependency, cannot be
  resolved (broken install / unbuilt workspace package), or does not declare
  `vendure.cliPlugin` — each with a distinct error message.
- A listed plugin that fails to load is skipped at startup with an error on
  stderr; the CLI stays usable so you can `vendure plugins remove` it.
