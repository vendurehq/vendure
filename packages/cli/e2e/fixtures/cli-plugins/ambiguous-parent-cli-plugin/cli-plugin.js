/**
 * A CLI plugin whose command declares both positional arguments and
 * subcommands. The first word after `deploy` would be ambiguous, so the plugin
 * is rejected when it is loaded.
 */
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/ambiguous-parent-cli-plugin',
    commands: [
        {
            name: 'deploy',
            description: 'Deploy the application',
            arguments: [{ name: 'target', description: 'What to deploy' }],
            action: async () => 0,
            subcommands: [
                {
                    name: 'plan',
                    description: 'Show what a deploy would change',
                    action: async () => 0,
                },
            ],
        },
    ],
});
