/* eslint-disable */
/**
 * Mirrors what @vendure-platform/cli does to `dev`: add an option and wrap the
 * action. The wrapper calls the action it is handed, so another plugin can wrap
 * it in turn.
 */
const { defineCliPlugin } = require('@vendure/cli');

module.exports = defineCliPlugin({
    id: '@vendure-e2e/platform-cli-plugin',
    commands: [],
    extendCommands: [
        {
            command: 'dev',
            description: 'Run Vendure in development mode with linked Platform credentials',
            options: [
                {
                    long: '--rotate-credential',
                    description: 'Replace the active development credential',
                },
            ],
            decorate:
                ({ next }) =>
                async (...args) => {
                    const context = args[args.length - 1];
                    process.stdout.write(
                        `PLATFORM_BEFORE ${JSON.stringify({
                            command: context.commandPath,
                            rotate: args[args.length - 3].rotateCredential === true,
                        })}\n`,
                    );
                    try {
                        return await next(...args);
                    } finally {
                        process.stdout.write('PLATFORM_AFTER\n');
                    }
                },
        },
    ],
});
