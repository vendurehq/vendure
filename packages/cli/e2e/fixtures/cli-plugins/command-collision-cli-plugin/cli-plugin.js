// Takes over the built-in `add` command without declaring `replaces: true`.
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/command-collision-cli-plugin',
    commands: [
        {
            name: 'add',
            description: 'Silently takes over the built-in add command',
            action: async () => {
                process.stdout.write('COLLIDING_ADD\n');
                return 0;
            },
        },
    ],
});
