// The decorator throws while the plugin is being registered.
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/broken-decorator-cli-plugin',
    commands: [{ name: 'broken-extra', description: 'Never registered', action: async () => 0 }],
    extendCommands: [
        {
            command: 'dev',
            decorate: () => {
                throw new Error('This decorator is broken on purpose');
            },
        },
    ],
});
