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
- There is **no** blanket-approve flag. Enable packages individually.
- `remove` writes the package into `vendure.cli.exclude` so startup hints stay quiet.
- Enabling a package fails if it is not a direct dependency or does not declare
  `vendure.cliPlugin`.
