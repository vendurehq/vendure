import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

export const migrateCommandDef: CliCommandDefinition = {
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
            long: '--from-empty',
            description:
                'Generate the migration by diffing against an empty shadow database, producing a ' +
                'complete baseline migration even when the configured database is already populated',
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
            const { migrateCommand } = await import('./migrate');
            await migrateCommand(options);
        });
    },
};
