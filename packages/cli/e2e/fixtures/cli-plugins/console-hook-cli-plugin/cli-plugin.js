/**
 * A project-scoped plugin with an `afterConsoleLink` hook. The hook
 * records that it ran, in the project it ran for, and contributes its setup to the result.
 */
const fs = require('node:fs');
const path = require('node:path');
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/console-hook-cli-plugin',
    commands: [],
    afterConsoleLink: async context => {
        fs.writeFileSync(
            path.join(context.projectRoot, 'console-hook-ran.json'),
            JSON.stringify({ outcome: context.outcome, options: context.options }),
        );
        context.contributeResult({ outcome: 'configured', data: { hook: 'ran' } });
    },
});
