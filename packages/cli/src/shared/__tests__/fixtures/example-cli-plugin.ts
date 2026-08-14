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
import { builtinCommands, defineCliPlugin } from '../../../index';

export default defineCliPlugin({
    id: '@vendure/cli-example-plugin',
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
            name: 'dev',
            description: 'Example wrap of the built-in dev command',
            action: async (target, options) => {
                process.stdout.write('Running wrapped vendure dev via plugin\n');
                return builtinCommands.dev.action(target, options);
            },
        },
    ],
});
