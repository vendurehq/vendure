// Declares commands the way a 3.8 plugin did. v4 refuses the plugin rather than ignoring them.
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/removed-commands-cli-plugin',
    commands: [{ name: 'legacy-extra', description: 'Never registered', action: async () => 0 }],
});
