/**
 * Example CLI plugin used in documentation and as a reference for plugin authors.
 * Not loaded by the CLI itself — see unit tests for fixture-based discovery.
 *
 * @example
 * In the plugin package's package.json:
 * {
 *   "vendure": {
 *     "cliPlugin": "./dist/cli-plugin.js"
 *   }
 * }
 */
import { builtinCommands, CliCommandContext, defineCliPlugin } from '../../../index';

interface ExampleSharedOptions {
    token?: string;
    json?: boolean;
}

export default defineCliPlugin({
    id: '@vendure/cli-example-plugin',
    // Shared by every command, and readable through `context.inheritedOptions`.
    rootOptions: [
        { long: '--token <token>', description: 'API token', required: true },
        { long: '--json', description: 'Print machine-readable output' },
    ],
    commands: [
        {
            name: 'example',
            description: 'Example command contributed by a CLI plugin',
            action: async () => {
                process.stdout.write('Hello from an example CLI plugin\n');
                return 0;
            },
        },
        {
            name: 'project',
            description: 'Example nested command group',
            options: [{ long: '--profile <name>', description: 'Configuration profile', required: true }],
            subcommands: [
                {
                    name: 'list',
                    description: 'List projects',
                    action: async (
                        options: Record<string, any>,
                        command: unknown,
                        context: CliCommandContext<ExampleSharedOptions>,
                    ) => {
                        process.stdout.write(
                            `Listing projects with token ${context.inheritedOptions.token ?? ''}\n`,
                        );
                        return 0;
                    },
                },
            ],
        },
        {
            name: 'dev',
            description: 'Example wrap of the built-in dev command',
            // Required to take over a command that already exists.
            replaces: true,
            action: async (target, options) => {
                process.stdout.write('Running wrapped vendure dev via plugin\n');
                return builtinCommands.dev.action(target, options);
            },
        },
    ],
});

/**
 * Companion package.json fields for this plugin:
 *
 * {
 *   "vendure": {
 *     "cliPlugin": "./dist/cli-plugin.js",
 *     "cliCommands": ["example", "project", "dev"]
 *   }
 * }
 *
 * Consumers must also list the package in their project package.json:
 *
 * {
 *   "vendure": {
 *     "cli": {
 *       "plugins": ["@vendure/cli-example-plugin"]
 *     }
 *   }
 * }
 */
