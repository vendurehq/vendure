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
import { defineCliPlugin } from '../../../index.js';

export default defineCliPlugin({
    id: '@vendure/cli-example-plugin',
    // Shared by every command, and readable through `context.inheritedOptions`.
    rootOptions: [
        { long: '--token <token>', description: 'API token', required: true },
        { long: '--json', description: 'Print machine-readable output' },
    ],
    extendCommands: [
        {
            // Adds to the built-in start command instead of replacing it, so
            // other plugins can wrap it too.
            command: 'start',
            options: [{ long: '--example-flag', description: 'An option added to start' }],
            decorate:
                ({ next }) =>
                async (...args) => {
                    process.stdout.write('Running wrapped vendure start via plugin\n');
                    // Call the action handed to us, never builtinCommands.start.action,
                    // so any other plugin wrapping start still runs.
                    return next(...args);
                },
        },
    ],
    // Runs after `vendure console link` has written the Project Link Manifest.
    // Adds to linking rather than replacing the console command, so every
    // project still links the same way.
    afterConsoleLink: async ({ projectRoot, manifest, reporter }) => {
        reporter.info(`Setting up ${manifest.project.name} in ${projectRoot}`);
    },
});

/**
 * Consumers must also list the package in their own package.json for it to be
 * loaded:
 *
 * {
 *   "vendure": {
 *     "cli": {
 *       "plugins": ["@vendure/cli-example-plugin"]
 *     }
 *   }
 * }
 */
