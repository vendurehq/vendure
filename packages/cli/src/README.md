# Vendure CLI Command Structure

This document describes the CLI command structure that supports both interactive and non-interactive modes, allowing for guided prompts during development and automated execution in CI/CD environments.

## Overview

The Vendure CLI supports two modes of operation:

- **Interactive Mode**: Provides guided prompts and menus for easy use during development
- **Non-Interactive Mode**: Allows direct command execution with arguments and options, perfect for scripting, CI/CD, and AI agents

The CLI uses a structured approach where all commands are defined in an array of `CliCommandDefinition` objects, making it easy to add, remove, and modify commands.

## Command Definition Interface

```typescript
interface CliCommandDefinition {
    name: string;                    // The command name (e.g., 'add', 'migrate')
    description: string;             // Command description shown in help
    options?: CliCommandOption[];    // Optional array of command options
    action: (options?: Record<string, any>) => Promise<void>; // Command implementation
}
```

## Option Definition Interface

```typescript
interface CliCommandOption {
    short?: string;                  // Short flag (e.g., '-p')
    long: string;                    // Long flag (e.g., '--plugin <name>')
    description: string;             // Option description
    required?: boolean;              // Whether the option is required
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
        const { addCommand } = await import('./add/add');
        await addCommand(options);
        process.exit(0);
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

## Adding New Commands

To add a new command, add it to the `cliCommands` array in `packages/cli/src/commands/command-declarations.ts`:

```typescript
export const cliCommands: CliCommandDefinition[] = [
    // ... existing commands ...
    {
        name: 'new-command',
        description: 'Description of the new command',
        options: [
            {
                short: '-o',
                long: '--option <value>',
                description: 'Description of the option',
                required: false,
            },
        ],
        action: async (options) => {
            const { newCommand } = await import('./new-command/new-command');
            await newCommand(options);
            process.exit(0);
        },
    },
];
```

## File Structure

- `packages/cli/src/shared/cli-command-definition.ts` - Interface definitions
- `packages/cli/src/shared/command-registry.ts` - Command registration utility
- `packages/cli/src/commands/command-declarations.ts` - Command declarations array
- `packages/cli/src/commands/add/add.ts` - Add command implementation with dual mode support
- `packages/cli/src/commands/migrate/migrate.ts` - Migrate command implementation with dual mode support
- `packages/cli/src/utilities/utils.ts` - Utility functions including timeout protection
- `packages/cli/src/cli.ts` - Main CLI entry point