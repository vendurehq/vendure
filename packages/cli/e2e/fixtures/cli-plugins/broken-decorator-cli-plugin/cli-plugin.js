// The decorator throws while the plugin is being registered.
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/broken-decorator-cli-plugin',
    extendCommands: [
        {
            command: 'start',
            decorate: () => {
                throw new Error('This decorator is broken on purpose');
            },
        },
    ],
});
