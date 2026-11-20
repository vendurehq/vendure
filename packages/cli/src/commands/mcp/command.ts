import { CliCommandDefinition } from '../../shared/cli-command-definition.js';
import { runCliCommand } from '../../shared/cli-command-exit.js';

/**
 * The Developer MCP server. It speaks MCP over stdio, so it is not a `defineCommand` command: its
 * stdout belongs to the protocol, and it has no envelope.
 */
export const mcpCommandDef: CliCommandDefinition = {
    name: 'mcp',
    description: 'Run the Developer MCP server over stdio',
    options: [
        {
            long: '--dir <path>',
            description: 'The Vendure project directory. Defaults to the current directory',
            required: false,
        },
        {
            long: '--mode <mode>',
            description:
                'discovery (default) offers search and one executor per behavior, direct lists every command',
            required: false,
            defaultValue: 'discovery',
        },
    ],
    action: async (options: { dir?: string; mode?: string }) => {
        return runCliCommand(async () => {
            const { runMcpCommand } = await import('./mcp.js');
            return runMcpCommand(options);
        });
    },
};
