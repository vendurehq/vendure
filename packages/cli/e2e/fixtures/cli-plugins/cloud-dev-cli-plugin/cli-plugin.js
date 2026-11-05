/**
 * A second plugin extending the same command, standing in for @vendure/cloud.
 */
const { defineCliPlugin, readCommandOptions } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/cloud-dev-cli-plugin',
    commands: [],
    extendCommands: [
        {
            command: 'dev',
            options: [
                {
                    long: '--cloud-env <name>',
                    description: 'Cloud environment to source configuration from',
                    required: true,
                },
            ],
            decorate:
                ({ command, next }) =>
                async (...args) => {
                    const options = readCommandOptions(args);
                    process.stdout.write(
                        `CLOUD_BEFORE ${JSON.stringify({
                            sawOptions: (command.options || []).map(option => option.long),
                            cloudEnv: options.cloudEnv,
                        })}\n`,
                    );
                    try {
                        return await next(...args);
                    } finally {
                        process.stdout.write('CLOUD_AFTER\n');
                    }
                },
        },
    ],
});
