/**
 * A CLI plugin shaped like the Vendure Cloud command surface: nested command
 * trees plus options shared by every command. Each action prints what the host
 * handed it, so the e2e tests can assert on it.
 */
const { defineCliPlugin } = require('@vendure/cli');

function report(context, options, positionals) {
    process.stdout.write(
        `CLOUD_RESULT ${JSON.stringify({
            command: context.commandPath,
            positionals: positionals || [],
            options,
            inherited: context.inheritedOptions,
        })}\n`,
    );
    return 0;
}

module.exports = defineCliPlugin({
    id: '@vendure-e2e/cloud-cli-plugin',
    rootOptions: [
        { long: '--token <token>', description: 'Cloud API token', required: true },
        { long: '--project <slug>', description: 'Cloud project slug', required: true },
        { long: '--environment <name>', description: 'Cloud environment name', required: true },
        { long: '--json', description: 'Print machine-readable output' },
    ],
    commands: [
        {
            name: 'project',
            description: 'Manage Cloud projects',
            subcommands: [
                {
                    name: 'list',
                    description: 'List the projects you can access',
                    options: [
                        { long: '--limit <n>', description: 'Maximum number of projects', required: true },
                    ],
                    action: async (options, command, context) => report(context, options),
                },
            ],
        },
        {
            name: 'config',
            description: 'Manage Cloud configuration',
            options: [{ long: '--profile <name>', description: 'Configuration profile', required: true }],
            subcommands: [
                {
                    name: 'server',
                    description: 'Server configuration',
                    subcommands: [
                        {
                            name: 'set',
                            description: 'Set a server configuration value',
                            arguments: [
                                { name: 'key', description: 'Configuration key', required: true },
                                { name: 'value', description: 'Configuration value', required: true },
                            ],
                            action: async (key, value, options, command, context) =>
                                report(context, options, [key, value]),
                        },
                    ],
                },
            ],
        },
        {
            name: 'backup',
            description: 'Manage backups',
            subcommands: [
                {
                    name: 'db',
                    description: 'Database backups',
                    subcommands: [
                        {
                            name: 'list',
                            description: 'List database backups',
                            action: async (options, command, context) => report(context, options),
                        },
                    ],
                },
            ],
        },
        {
            name: 'restore',
            description: 'Restore from a backup',
            subcommands: [
                {
                    name: 'db',
                    description: 'Restore the database from a backup',
                    arguments: [{ name: 'backupId', description: 'Backup to restore', required: true }],
                    action: async (backupId, options, command, context) =>
                        report(context, options, [backupId]),
                },
            ],
        },
    ],
});
