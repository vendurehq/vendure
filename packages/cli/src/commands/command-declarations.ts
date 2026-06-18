import { CliCommandDefinition } from '../shared/cli-command-definition';

import { addApiExtension } from './add/api-extension/add-api-extension';
import { addCodegen } from './add/codegen/add-codegen';
import { addDashboard } from './add/dashboard/add-dashboard';
import { addEntity } from './add/entity/add-entity';
import { addJobQueue } from './add/job-queue/add-job-queue';
import { createNewPlugin } from './add/plugin/create-new-plugin';
import { addService } from './add/service/add-service';

export const cliCommands: CliCommandDefinition[] = [
    {
        name: 'add',
        description: 'Add a feature to your Vendure project',
        options: [
            {
                long: '--config <path>',
                description: 'Specify the path to a custom Vendure config file',
                required: false,
            },
            {
                short: '-p',
                long: '--plugin <name>',
                description: 'Create a new plugin with the specified name',
                required: false,
                interactiveId: 'create-new-plugin',
                interactiveCategory: 'Plugin',
                interactiveFn: createNewPlugin,
            },
            {
                short: '-e',
                long: '--entity <name>',
                description: 'Add a new entity to a plugin',
                required: false,
                interactiveId: 'add-entity',
                interactiveCategory: 'Plugin: Entity',
                interactiveFn: addEntity,
                subOptions: [
                    {
                        long: '--selected-plugin <name>',
                        description: 'Name of the plugin to add the entity to (required with -e)',
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
                description: 'Add a new service to a plugin',
                required: false,
                interactiveId: 'add-service',
                interactiveCategory: 'Plugin: Service',
                interactiveFn: addService,
                subOptions: [
                    {
                        long: '--selected-plugin <name>',
                        description: 'Name of the plugin to add the service to (required with -s)',
                        required: false,
                    },
                    {
                        long: '--type <type>',
                        description: 'Type of service: basic or entity (default: basic)',
                        required: false,
                    },
                    {
                        long: '--selected-entity <n>',
                        description:
                            'Name of the entity for entity service (automatically sets type to entity)',
                        required: false,
                    },
                ],
            },
            {
                short: '-j',
                long: '--job-queue [plugin]',
                description: 'Add job queue support to a plugin',
                required: false,
                interactiveId: 'add-job-queue',
                interactiveCategory: 'Plugin: Job Queue',
                interactiveFn: addJobQueue,
                subOptions: [
                    {
                        long: '--name <name>',
                        description: 'Name for the job queue (required with -j)',
                        required: false,
                    },
                    {
                        long: '--selected-service <name>',
                        description: 'Name of the service to add the job queue to (required with -j)',
                        required: false,
                    },
                ],
            },
            {
                short: '-c',
                long: '--codegen [plugin]',
                description: 'Set up GraphQL code generation',
                required: false,
                interactiveId: 'add-codegen',
                interactiveCategory: 'Project: Codegen',
                interactiveFn: addCodegen,
            },
            {
                short: '-a',
                long: '--api-extension [plugin]',
                description: 'Add an API extension to a plugin',
                required: false,
                interactiveId: 'add-api-extension',
                interactiveCategory: 'Plugin: API',
                interactiveFn: addApiExtension,
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
                    {
                        long: '--selected-service <name>',
                        description: 'Name of the service to add the API extension to (required with -a)',
                        required: false,
                    },
                ],
            },
            {
                short: '-d',
                long: '--dashboard [plugin]',
                description: 'Add Dashboard extensions to a plugin',
                required: false,
                interactiveId: 'add-dashboard',
                interactiveCategory: 'Plugin: Dashboard',
                interactiveFn: addDashboard,
            },
            {
                short: '-u',
                long: '--ui-extensions [plugin]',
                description:
                    'Add UI extensions to a plugin (deprecated: considering migrating to the new Dashboard)',
                required: false,
            },
        ],
        action: async options => {
            const { addCommand } = await import('./add/add');
            await addCommand(options);
            process.exit(0);
        },
    },
    {
        name: 'migrate',
        description: 'Generate, run or revert a database migration',
        options: [
            {
                short: '-g',
                long: '--generate <name>',
                description: 'Generate a new migration with the specified name',
                required: false,
            },
            {
                short: '-r',
                long: '--run',
                description: 'Run pending migrations',
                required: false,
            },
            {
                long: '--revert',
                description: 'Revert the last migration',
                required: false,
            },
            {
                short: '-o',
                long: '--output-dir <path>',
                description: 'Output directory for generated migrations',
                required: false,
            },
            {
                long: '--config <path>',
                description: 'Specify the path to a custom Vendure config file',
                required: false,
            },
        ],
        action: async options => {
            const { migrateCommand } = await import('./migrate/migrate');
            await migrateCommand(options);
            process.exit(0);
        },
    },
    {
        name: 'codemod',
        description: 'Run codemods to update your Vendure project code',
        arguments: [
            {
                name: 'transform',
                description: 'Name of the codemod to run (e.g. dashboard-ui)',
                required: false,
            },
            {
                name: 'path',
                description: 'Path to the files or directory to transform',
                required: false,
            },
        ],
        action: async (transform, path, _options) => {
            const { codemodCommand } = await import('./codemod/codemod');
            await codemodCommand(transform, path);
            process.exit(0);
        },
    },
    {
        name: 'schema',
        description: 'Generate a schema file from your GraphQL APIs',
        options: [
            {
                short: '-a',
                long: '--api <admin|shop>',
                description: 'Which GraphQL API to generate a schema for',
                required: true,
            },
            {
                short: '-d',
                long: '--dir <dir>',
                description: 'Output directory. Defaults to current directory.',
                required: false,
            },
            {
                short: '-n',
                long: '--file-name <name>',
                description: 'File name. Defaults to "schema.graphql|json" or "schema-shop.graphql|json"',
                required: false,
            },
            {
                short: '-f',
                long: '--format <sdl|json>',
                description: 'Output format, either SDL or JSON',
                required: false,
            },
            {
                long: '--config <path>',
                description: 'Specify the path to a custom Vendure config file',
                required: false,
            },
        ],
        action: async options => {
            const { schemaCommand } = await import('./schema/schema');
            await schemaCommand({
                ...options,
                outputDir: options?.dir,
            });
            process.exit(0);
        },
    },
];
