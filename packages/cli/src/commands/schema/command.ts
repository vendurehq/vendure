import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

export const schemaCommandDef: CliCommandDefinition = {
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
        return runCliCommand(async () => {
            const { schemaCommand } = await import('./schema');
            await schemaCommand({
                ...options,
                outputDir: options?.dir,
            });
        });
    },
};
