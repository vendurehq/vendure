import { CliCommandDefinition } from '../../shared/cli-command-definition.js';
import { runCliCommand } from '../../shared/cli-command-exit.js';

export const addCommandDef: CliCommandDefinition = {
    name: 'add',
    description: 'Add a feature to your Vendure project',
    requiresProject: true,
    options: [
        {
            long: '--config <path>',
            description: 'Specify the path to a custom Vendure config file',
            required: false,
        },
        {
            long: '--platform',
            description: 'Vendure Platform features (B2B, advanced search, ...), free trial',
            required: false,
        },
        {
            short: '-p',
            long: '--plugin <name>',
            description: 'Create a new plugin with the specified name. Same as `vendure add plugin`',
            required: false,
        },
        {
            short: '-e',
            long: '--entity <name>',
            description: 'Add a new entity to a plugin. Same as `vendure add entity`',
            required: false,
            subOptions: [
                {
                    long: '--selected-plugin <name>',
                    description:
                        'Name of the plugin to add the entity or service to (required with -e or -s)',
                    required: false,
                },
                {
                    long: '--custom-fields',
                    description: 'Add custom fields support to the entity',
                    required: false,
                },
                {
                    long: '--translatable',
                    description: 'Make the entity translatable',
                    required: false,
                },
            ],
        },
        {
            short: '-s',
            long: '--service <name>',
            description: 'Add a new service to a plugin. Same as `vendure add service`',
            required: false,
            subOptions: [
                {
                    long: '--selected-entity <n>',
                    description: 'An entity of the plugin. The service then has CRUD methods for it',
                    required: false,
                },
            ],
        },
        {
            short: '-j',
            long: '--job-queue [plugin]',
            description: 'Add job queue support to a plugin. Same as `vendure add job-queue`',
            required: false,
            subOptions: [
                {
                    long: '--name <name>',
                    description: 'Name for the job queue (required with -j)',
                    required: false,
                },
                {
                    long: '--selected-service <name>',
                    description:
                        'Name of the service to add the job queue or API extension to (required with -j or -a)',
                    required: false,
                },
            ],
        },
        {
            short: '-a',
            long: '--api-extension [plugin]',
            description: 'Add an API extension to a plugin. Same as `vendure add api-extension`',
            required: false,
            subOptions: [
                {
                    long: '--query-name <name>',
                    description: 'Name for the query (used with -a)',
                    required: false,
                },
                {
                    long: '--mutation-name <name>',
                    description: 'Name for the mutation (used with -a)',
                    required: false,
                },
            ],
        },
        {
            short: '-d',
            long: '--dashboard [plugin]',
            description: 'Add Dashboard extensions to a plugin. Same as `vendure add dashboard`',
            required: false,
        },
    ],
    action: async options => {
        return runCliCommand(async () => {
            const { addCommand } = await import('./add.js');
            return addCommand(options);
        });
    },
};
