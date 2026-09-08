import { CliCommandDefinition } from '../../shared/cli-command-definition';
import { runCliCommand } from '../../shared/cli-command-exit';

export const devCommandDef: CliCommandDefinition = {
    name: 'dev',
    description: 'Run Vendure in development mode',
    arguments: [
        {
            name: 'target',
            description: 'Target to run: all, server, worker or dashboard (default: all)',
            required: false,
        },
    ],
    options: [
        {
            long: '--server-entry <path>',
            description:
                'Path to the TypeScript server entry file that calls bootstrap() (default: ./src/index.ts)',
            required: false,
        },
        {
            long: '--worker-entry <path>',
            description:
                'Path to the TypeScript worker entry file that calls bootstrapWorker() (default: ./src/index-worker.ts)',
            required: false,
        },
        {
            long: '--vite-config <path>',
            description:
                'Path to the Vite config file used by the Dashboard (default: Vite config discovery)',
            required: false,
        },
        {
            long: '--inspect [host:port]',
            description:
                'Enable the Node.js inspector for server and worker processes (default: disabled; dev all uses ports 9229/9230)',
            required: false,
        },
        {
            long: '--inspect-brk [host:port]',
            description:
                'Enable the Node.js inspector and break before user code starts (default: disabled; dev all uses ports 9229/9230)',
            required: false,
        },
        {
            long: '--no-reload',
            description: 'Disable automatic server and worker restarts when backend source files change',
            required: false,
        },
    ],
    action: async (target, options) => {
        return runCliCommand(async () => {
            const { devCommand } = await import('./dev');
            return devCommand(target, options);
        });
    },
};
