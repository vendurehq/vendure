import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

export const startCommandDef: CliCommandDefinition = {
    name: 'start',
    description: 'Start a built Vendure project',
    arguments: [
        {
            name: 'target',
            description: 'Target to start: all, server or worker (default: all)',
            required: false,
        },
    ],
    options: [
        {
            long: '--server-entry <path>',
            description: 'Path to the compiled server entry file (default: ./dist/index.js)',
            required: false,
        },
        {
            long: '--worker-entry <path>',
            description: 'Path to the compiled worker entry file (default: ./dist/index-worker.js)',
            required: false,
        },
    ],
    action: async (target, options) => {
        return runCliCommand(async () => {
            const { startCommand } = await import('./start');
            return startCommand(target, options);
        });
    },
};
