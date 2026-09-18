// Replaces `dev` outright, which must be refused once another plugin has
// extended it.
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/dev-replacement-cli-plugin',
    commands: [
        {
            name: 'dev',
            description: 'Replaces the built-in dev command outright',
            replaces: true,
            action: async () => {
                process.stdout.write('REPLACEMENT_DEV\n');
                return 0;
            },
        },
    ],
});
