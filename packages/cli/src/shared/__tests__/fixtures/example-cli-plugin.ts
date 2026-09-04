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
import { CliCommandContext, defineCliPlugin } from '../../../index';

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
    ],
    extendCommands: [
        {
            // Adds to the built-in dev command instead of replacing it, so
            // other plugins can wrap it too.
            command: 'dev',
            options: [{ long: '--example-flag', description: 'An option added to dev' }],
            decorate:
                ({ next }) =>
                async (...args) => {
                    process.stdout.write('Running wrapped vendure dev via plugin\n');
                    // Call the action handed to us, never builtinCommands.dev.action,
                    // so any other plugin wrapping dev still runs.
                    return next(...args);
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
 *     "cliCommands": ["example", "project"]
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
