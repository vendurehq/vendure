import { CliCommandGroupDefinition } from '../../shared/cli-command-definition.js';
import { runCliCommand } from '../../shared/cli-command-exit.js';

export const authCommandDef: CliCommandGroupDefinition = {
    name: 'auth',
    description: 'Sign in to your Vendure account',
    subcommands: [
        {
            name: 'login',
            description: 'Sign in with your browser and store the login on this machine',
            options: [
                {
                    long: '--organization <account>',
                    description:
                        'Sign in to this organization: its Account identifier (Vendure Console → Settings) or its name, ignoring case',
                    required: false,
                },
            ],
            action: async options => {
                return runCliCommand(async () => {
                    const { authLoginCommand } = await import('./auth.js');
                    return authLoginCommand(options);
                });
            },
        },
        {
            name: 'status',
            description: 'Show who is signed in',
            options: [
                {
                    long: '--json',
                    description: 'Print the login status as JSON. Never includes tokens.',
                    required: false,
                },
            ],
            action: async options => {
                return runCliCommand(async () => {
                    const { authStatusCommand } = await import('./auth.js');
                    return authStatusCommand(options);
                });
            },
        },
        {
            name: 'logout',
            description: 'Remove the login from this machine',
            action: async () => {
                return runCliCommand(async () => {
                    const { authLogoutCommand } = await import('./auth.js');
                    return authLogoutCommand();
                });
            },
        },
    ],
};
