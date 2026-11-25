// Replaces `start` outright, which must be refused once another plugin has
// extended it.
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/start-replacement-cli-plugin',
    commands: [
        {
            name: 'start',
            description: 'Replaces the built-in start command outright',
            replaces: true,
            action: async () => {
                process.stdout.write('REPLACEMENT_START\n');
                return 0;
            },
        },
    ],
});
