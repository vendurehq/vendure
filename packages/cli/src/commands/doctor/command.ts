import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

// No `requiresProject`: doctor is the command that diagnoses a project, and
// "this directory is not a Vendure project" is one of the things it reports.
// Refusing to run would remove the answer in the case that most needs it. Its
// own project check reports the problem and the checks that depend on a config
// are skipped, so running it anywhere is safe as well as useful.
export const doctorCommandDef: CliCommandDefinition = {
    name: 'doctor',
    description: 'Run diagnostic checks on your Vendure project',
    options: [
        {
            long: '--config <path>',
            description: 'Specify the path to a custom Vendure config file',
            required: false,
        },
        {
            long: '--check <names...>',
            description: 'Run specific checks only (project, dependencies, config, schema, database)',
            required: false,
        },
        {
            long: '--profile <name>',
            description: 'Run profile-specific checks (production)',
            required: false,
        },
        {
            long: '--format <type>',
            description: 'Output format: text (default) or json',
            required: false,
        },
        {
            long: '--strict',
            description: 'Treat warnings as failures (useful for CI)',
            required: false,
        },
    ],
    action: async options => {
        return runCliCommand(async () => {
            const { doctorCommand } = await import('./doctor');
            return doctorCommand(options);
        });
    },
};
