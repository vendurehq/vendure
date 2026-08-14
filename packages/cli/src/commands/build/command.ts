import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

export const buildCommandDef: CliCommandDefinition = {
    name: 'build',
    description: 'Build a Vendure project',
    arguments: [
        {
            name: 'target',
            description: 'Target to build: all, server, worker or dashboard (default: all)',
            required: false,
        },
    ],
    options: [
        {
            long: '--tsconfig <path>',
            description:
                'Path to the server TypeScript config file (also used by the worker unless --worker-tsconfig is set; ' +
                'default: first existing tsconfig.server.json, tsconfig.build.json or tsconfig.json)',
            required: false,
        },
        {
            long: '--worker-tsconfig <path>',
            description:
                'Path to the worker TypeScript config file (default: --tsconfig or first existing tsconfig.worker.json, tsconfig.build.json or tsconfig.json)',
            required: false,
        },
        {
            long: '--vite-config <path>',
            description:
                'Path to the Vite config file used by the Dashboard (default: Vite config discovery)',
            required: false,
        },
        {
            long: '--experimental-tsgo',
            description:
                'Use the experimental native TypeScript compiler for server and worker builds (default: use tsc)',
            required: false,
        },
        {
            long: '--clean',
            description: 'Clean build output directories before building (default: false)',
            required: false,
        },
        {
            long: '--no-progress',
            description:
                'Disable spinner/progress rendering for stable logs (default: enabled in interactive non-CI builds)',
            required: false,
        },
        {
            long: '--verbose',
            description: 'Show full build output from underlying tools (default: false)',
            required: false,
        },
        {
            long: '--watch',
            description: 'Watch source files and rebuild when they change (default: false)',
            required: false,
        },
    ],
    action: async (target, options) => {
        return runCliCommand(async () => {
            const { buildCommand } = await import('./build');
            return buildCommand(target, options);
        });
    },
};
