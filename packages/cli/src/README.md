# Vendure CLI Command Structure

This document describes the CLI command structure that supports both interactive and non-interactive modes, allowing for guided prompts during development and automated execution in CI/CD environments.

## Overview

The Vendure CLI supports two modes of operation:

- **Interactive Mode**: Provides guided prompts and menus for easy use during development
- **Non-Interactive Mode**: Allows direct command execution with arguments and options, perfect for scripting, CI/CD, and AI agents

The CLI uses a structured approach where each built-in command owns a
`CliCommandDefinition` next to its implementation, and external packages can
contribute or replace commands via the CLI plugin API (`defineCliPlugin`).

## Command Definition Interface

```typescript
interface CliCommandDefinition {
    name: string; // The command name (e.g., 'add', 'migrate')
    description: string; // Command description shown in help
    arguments?: CliCommandArgument[]; // Optional positional arguments
    options?: CliCommandOption[]; // Optional array of command options
    replaces?: boolean; // Deliberately replace a command of the same name
    action: (...args: any[]) => Promise<void | number>; // Command implementation
}
```

A command that groups further commands declares `subcommands` instead of an
action. Groups can be nested to any depth, and running one without a subcommand
prints its help.

```typescript
interface CliCommandGroupDefinition {
    name: string;
    description: string;
    options?: CliCommandOption[]; // Shared by every command in the group
    subcommands: CliCommandNode[]; // A command or a further group
    replaces?: boolean;
}

type CliCommandNode = CliCommandDefinition | CliCommandGroupDefinition;
```

## Command Extension Interface

A plugin adds to a command that is already registered, instead of replacing it,
so that several plugins can contribute to the same command.

```typescript
interface CliCommandExtension {
    command: string | string[]; // 'dev', or ['config', 'server', 'set']
    description?: string; // Replaces the description in help
    options?: CliCommandOption[]; // Appended to the command's options
    decorate?: CliCommandDecorator; // Wraps the command's action
}

type CliCommandDecorator = (input: CliCommandDecoratorInput) => CliCommandAction;

interface CliCommandDecoratorInput {
    command: Readonly<CliCommandDefinition>; // The command as composed so far
    next: CliCommandAction; // Its action: call it to run everything below
}
```

## Command Context

Commander passes positional arguments first, then the parsed options object and
the `Command` instance. The CLI host appends a `CliCommandContext`, so an action
never has to read or reparse `process.argv`. An action taking `...args` in order
to forward them should read the tail with the exported `readCommandContext()`
and `readCommandOptions()` rather than indexing:

```typescript
interface CliCommandContext<TInheritedOptions extends Record<string, any> = Record<string, any>> {
    inheritedOptions: TInheritedOptions; // Values of the shared options in scope
    commandPath: string[]; // e.g. ['config', 'server', 'set']
}
```

## Option Definition Interface

```typescript
interface CliCommandOption {
    short?: string; // Short flag (e.g., '-p')
    long: string; // Long flag (e.g., '--plugin <name>')
    description: string; // Option description
    required?: boolean; // Whether a value must follow the flag, not whether the flag is required
    defaultValue?: any; // Value used when the flag is absent
    subOptions?: CliCommandOption[]; // Sub-options for complex commands
}
```

## Interactive vs Non-Interactive Mode Detection

Commands automatically detect which mode to use based on provided options:

```typescript
// Non-interactive mode is triggered when any option has a truthy value (not false)
const nonInteractive = options && Object.values(options).some(v => v !== undefined && v !== false);

if (nonInteractive) {
    await handleNonInteractiveMode(options);
} else {
    await handleInteractiveMode();
}
```

## Available Commands

### Dev Command

The `dev` command starts the development processes for a Vendure project.

```bash
# Start the server, worker and Dashboard
npx vendure dev all

# Start only the server
npx vendure dev server

# Start only the worker
npx vendure dev worker

# Start only the Dashboard
npx vendure dev dashboard

# Start with custom entrypoints
npx vendure dev all --server-entry ./src/server.ts --worker-entry ./src/jobs.ts

# Start the Dashboard with a custom Vite config
npx vendure dev dashboard --vite-config ./config/vite.dashboard.mts

# Start server and worker with the Node.js inspector
npx vendure dev all --inspect

# Start without automatic server/worker reloads
npx vendure dev all --no-reload
```

The server and worker dev targets automatically restart when backend source files change. Dashboard
extension directories are excluded from these restarts because `vendure dev dashboard` runs Vite, which
handles Dashboard hot updates separately.

### Build Command

The `build` command builds a Vendure project.

```bash
# Build the server, worker and Dashboard
npx vendure build all

# Build the server TypeScript project with tsc
npx vendure build server

# Build the worker TypeScript project with tsc
npx vendure build worker

# Build the Dashboard
npx vendure build dashboard
```

By default, server and worker TypeScript configs are discovered in this order:
`tsconfig.server.json`/`tsconfig.worker.json`, then `tsconfig.build.json`, then `tsconfig.json`.

```bash
# Use a custom TypeScript config
npx vendure build server --tsconfig ./tsconfig.server.json

# Use a separate worker TypeScript config
npx vendure build all --tsconfig ./tsconfig.server.json --worker-tsconfig ./tsconfig.worker.json

# Clean output directories before building
npx vendure build all --clean

# Watch source files and rebuild
npx vendure build all --watch

# Use the experimental native TypeScript compiler
npx vendure build server --experimental-tsgo

# Show full output from the underlying build tools
npx vendure build all --verbose

# Disable progress rendering for stable logs in scripts or agents
npx vendure build all --no-progress
```

### Start Command

The `start` command starts compiled server and worker entrypoints.

```bash
# Start the server and worker
npx vendure start all

# Start only the server
npx vendure start server

# Start only the worker
npx vendure start worker

# Start with custom compiled entrypoints
npx vendure start all --server-entry ./build/server.js --worker-entry ./build/worker.js
```

### Add Command

The `add` command supports both modes for adding features to your Vendure project.

**Interactive Mode:**

```bash
npx vendure add
```

**Non-Interactive Mode:**

```bash
# Create a new plugin
npx vendure add -p MyPlugin

# Add an entity to a plugin
npx vendure add -e MyEntity --selected-plugin MyPlugin

# Add an entity with features
npx vendure add -e MyEntity --selected-plugin MyPlugin --custom-fields --translatable

# Add a service to a plugin
npx vendure add -s MyService --selected-plugin MyPlugin

# Add a service with specific type
npx vendure add -s MyService --selected-plugin MyPlugin --type entity

# Add job queue support to a plugin
npx vendure add -j MyPlugin --name my-job --selected-service MyService

# Add GraphQL codegen to a plugin
npx vendure add -c MyPlugin

# Add API extension to a plugin
npx vendure add -a MyPlugin --queryName getCustomData --mutationName updateCustomData

# Add UI extensions to a plugin
npx vendure add -u MyPlugin
```

### Migrate Command

The `migrate` command supports both modes for database migration management.

**Interactive Mode:**

```bash
npx vendure migrate
```

**Non-Interactive Mode:**

```bash
# Generate a new migration
npx vendure migrate -g my-migration-name

# Run pending migrations
npx vendure migrate -r

# Revert the last migration
npx vendure migrate --revert

# Generate migration with custom output directory
npx vendure migrate -g my-migration -o ./custom/migrations
```

## Command Implementation Patterns

### Basic Command Structure

```typescript
import { runCliCommand } from '../../shared/cli-command-exit';

{
    name: 'add',
    description: 'Add a feature to your Vendure project',
    options: [
        {
            short: '-p',
            long: '--plugin <name>',
            description: 'Create a new plugin with the specified name',
            required: false,
        },
        {
            short: '-e',
            long: '--entity <name>',
            description: 'Add a new entity to a plugin',
            required: false,
        },
        // ... more options
    ],
    action: async (options) => {
        return runCliCommand(async () => {
            const { addCommand } = await import('./add/add');
            await addCommand(options);
        });
    },
}
```

### Command with Sub-Options

```typescript
{
    short: '-j',
    long: '--job-queue [plugin]',
    description: 'Add job-queue support to the specified plugin',
    required: false,
    subOptions: [
        {
            long: '--name <name>',
            description: 'Name for the job queue (required with -j)',
            required: false,
        },
        {
            long: '--selected-service <name>',
            description: 'Name of the service to add the job queue to (required with -j)',
            required: false,
        },
    ],
},
{
    short: '-e',
    long: '--entity <name>',
    description: 'Add a new entity with the specified class name',
    required: false,
    subOptions: [
        {
            long: '--selected-plugin <name>',
            description: 'Name of the plugin to add the entity to (required with -e)',
            required: false,
        },
        {
            long: '--custom-fields',
            description: 'Add custom fields support to the entity',
            required: false,
        },
        {
            long: '--translatable',
            description: 'Make the entity translatable',
            required: false,
        },
    ],
},
{
    short: '-s',
    long: '--service <name>',
    description: 'Add a new service with the specified class name',
    required: false,
    subOptions: [
        {
            long: '--selected-plugin <name>',
            description: 'Name of the plugin to add the service to (required with -s)',
            required: false,
        },
        {
            long: '--type <type>',
            description: 'Type of service: basic or entity (default: basic)',
            required: false,
        },
    ],
}
```

### Non-Interactive Mode Validation

Commands implement validation for non-interactive mode to ensure all required parameters are provided.

### Entity and Service Commands

Entity and service commands now support non-interactive mode with the `--selected-plugin` parameter to specify the target plugin. Both commands support additional options for customization:

- Entity commands support `--custom-fields` and `--translatable` flags
- Service commands support `--type` parameter to specify service type (basic or entity)

**Example Error Handling:**

```bash
$ npx vendure add -e MyEntity --selected-plugin NonExistentPlugin
Error: Plugin "NonExistentPlugin" not found. Available plugins: MyActualPlugin, AnotherPlugin
```

## Interactive Mode Features

### Timeout Protection

Interactive prompts include timeout protection to prevent hanging in automated environments

## Adding Built-in Commands

Each built-in command owns its definition next to its implementation:

1. Create `packages/cli/src/commands/<name>/command.ts` exporting a `CliCommandDefinition`
2. Register it in the `builtinCommandDefs` array in `packages/cli/src/commands/builtins.ts`

```typescript
// packages/cli/src/commands/hello/command.ts
import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

export const helloCommandDef: CliCommandDefinition = {
    name: 'hello',
    description: 'Description of the new command',
    options: [
        {
            short: '-o',
            long: '--option <value>',
            description: 'Description of the option',
            required: false,
        },
    ],
    action: async options => {
        return runCliCommand(async () => {
            const { helloCommand } = await import('./hello');
            await helloCommand(options);
        });
    },
};
```

Keep the lazy `import()` inside the action so heavy command modules are not loaded at CLI startup.

## Extending the CLI with Plugins

External packages add commands, add to existing ones, or replace them by
exporting a CLI plugin with `defineCliPlugin`.

**The plugin API reference lives in the developer guide**, under
[Extending the CLI](https://docs.vendure.io/guides/developer-guide/cli/#extending-the-cli): the
`extendCommands` composition model, shared options and their precedence, the
collision rules, and discovery and activation. That page is the source of truth
for plugin authors; this file covers what a contributor to the CLI itself needs.

### How registration works

1. `cli.ts` builds a `CommandRegistry` and calls `registerAll(builtinCommandDefs)`.
2. `resolveCliPlugins()` loads the packages listed in `vendure.cli.plugins`,
   returning failures rather than throwing.
3. Each loaded plugin goes through `registry.applyPlugin()`, which is the only
   path that enforces the collision rules. It applies the plugin's root options,
   commands and extensions to a **draft** copy of the registry state and commits
   the draft only if nothing conflicts, so a plugin's contributions are either
   all registered or none are.
4. A plugin that conflicts is reported on stderr and skipped. Built-ins stay
   registered, which is what keeps `vendure plugins remove` reachable.
5. `registerCommands()` walks the resulting tree onto Commander.

### Things worth knowing before changing this code

- **Commander accepts an option anywhere on the command line** once the command
  declaring it has been reached, so shared options are declared once on their
  owning command and never copied onto descendants. `registerCommands()` enables
  Commander's `showGlobalOptions` so subcommand help still lists them.
- **The ancestor that declared the shared option wins the parse.** When a
  command declares the same flag as a shared option, Commander gives the value
  to the ancestor, so `fillSharedValues()` writes it into the options object
  Commander passed to the action, and onto the `Command`, so both readings
  agree. Registration rejects the two declarations if they disagree about
  whether a value follows the flag. Covered in `command-registry.spec.ts`.
- **Extensions cannot add positional arguments.** Commander passes one argument
  slot per declared positional, so an appended argument would shift the options,
  `Command` and context that an existing action expects.
- **Extension order is `vendure.cli.plugins` order**, so the last listed plugin
  is the outermost wrapper and its decorator runs first.
- **Nodes are never mutated.** `extendNode()` returns new objects, so
  `builtinCommands.<name>` keeps pointing at the original definition and each
  decorator wraps only what was registered before it.

## File Structure

- `packages/cli/src/shared/cli-command-definition.ts` - Interface definitions
- `packages/cli/src/shared/cli-command-options.ts` - Option flag parsing shared by registration and collision checks
- `packages/cli/src/shared/cli-plugin.ts` - `defineCliPlugin` / `CliPlugin`
- `packages/cli/src/shared/cli-plugin-project-config.ts` - Read/write `vendure.cli` allowlist
- `packages/cli/src/shared/command-registry-store.ts` - Command registry (add, replace, extend)
- `packages/cli/src/shared/resolve-cli-plugins.ts` - Plugin discovery & loading
- `packages/cli/src/shared/command-registry.ts` - Commander registration utility
- `packages/cli/src/commands/builtins.ts` - Ordered list of built-in command definitions
- `packages/cli/src/commands/<name>/command.ts` - Per-command definition (metadata + lazy action)
- `packages/cli/src/index.ts` - Public API exports for plugin authors
- `packages/cli/src/commands/add/add.ts` - Add command implementation with dual mode support
- `packages/cli/src/commands/migrate/migrate.ts` - Migrate command implementation with dual mode support
- `packages/cli/src/commands/plugins/plugins.ts` - Explicit CLI plugin activation
- `packages/cli/src/utilities/utils.ts` - Utility functions including timeout protection
- `packages/cli/src/cli.ts` - Main CLI entry point
