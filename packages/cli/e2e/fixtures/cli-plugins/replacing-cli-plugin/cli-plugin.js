/* eslint-disable */
// Deliberately replaces a built-in command.
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/replacing-cli-plugin',
    commands: [
        {
            name: 'doctor',
            description: 'Replaces the built-in doctor command',
            replaces: true,
            action: async () => {
                process.stdout.write('REPLACED_DOCTOR\n');
                return 0;
            },
        },
    ],
});
