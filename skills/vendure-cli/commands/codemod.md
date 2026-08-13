# vendure codemod

Runs an automated code transform over a Vendure project.

## Interactive vs non-interactive

Running `vendure codemod` with **no `transform` argument** launches an
interactive picker that blocks on a prompt. **Agents must pass the transform
name** so the command runs non-interactively.

## Usage

```bash
vendure codemod <transform> [directory]
```

- `transform` — name of the codemod to run (see below).
- `directory` — optional directory to transform. Defaults to the current
  working directory. The CLI validates that this path exists and is a
  directory. Only supported in non-interactive mode.

## Available transforms

| Transform           | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| `dashboard-base-ui` | Migrate dashboard extensions from Radix UI to Base UI patterns |

Run `vendure codemod` (interactively) or check the CLI's codemod registry
for the current list if a transform name is not recognised.

## Examples

```bash
vendure codemod dashboard-base-ui
vendure codemod dashboard-base-ui ./src/plugins/my-plugin
```
