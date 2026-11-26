// Declares the root option the platform fixture already declares, so registering it fails.
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/clashing-root-option-cli-plugin',
    rootOptions: [{ long: '--token <token>', description: 'A second API token' }],
});
