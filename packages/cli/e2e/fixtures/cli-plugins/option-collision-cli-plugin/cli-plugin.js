/* eslint-disable */
// Registers a shared option that another plugin already owns.
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/option-collision-cli-plugin',
    rootOptions: [{ long: '--token <token>', description: 'A rival API token', required: true }],
    commands: [
        {
            name: 'rival',
            description: 'A command from a plugin with a colliding shared option',
            action: async () => 0,
        },
    ],
});
