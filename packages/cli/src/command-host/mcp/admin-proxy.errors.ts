import { defineError } from '@vendure/common/lib/command';

/**
 * Why the `admin_*` tools of the Developer MCP cannot be called, beyond the errors of the local
 * Admin API helper (`localAdminApiErrors`). They are returned as the result of the tool call, with
 * fixes the agent can run as tools.
 */
export const adminToolsErrors = {
    noProject: defineError<Record<string, never>>({
        code: 'mcp.admin-tools.no-project',
        exit: 1,
        message: () =>
            "The admin_* tools call the Store MCP of the project's dev server, but the Developer MCP " +
            'was not started in a Vendure project. Start it in the project, or pass --dir.',
    }),
    storeMcpMissing: defineError<Record<string, never>>({
        code: 'mcp.admin-tools.store-mcp-missing',
        exit: 1,
        message: () =>
            'The dev server does not serve the Store MCP to the Developer MCP. Add ' +
            "McpPlugin.init({ oauth: {}, shopAccess: 'anonymous' }) from @vendure/mcp-plugin to the " +
            'plugins in vendure-config.ts, and leave its localTrust option on. The tool list updates ' +
            'when the dev server restarts.',
    }),
    storeUnreachable: defineError<{ reason: string }>({
        code: 'mcp.admin-tools.store-unreachable',
        exit: 1,
        message: ({ reason }) => `The Store MCP of the dev server could not be called: ${reason}.`,
        fix: () => [
            {
                path: ['devserver', 'status'],
                input: {},
                description: 'Check that the dev server is still running',
            },
        ],
    }),
    storeTimedOut: defineError<{ seconds: number }>({
        code: 'mcp.admin-tools.store-timed-out',
        exit: 1,
        message: ({ seconds }) =>
            `The Store MCP of the dev server did not answer within ${seconds} seconds. The call may ` +
            'still have run, so check its effect with a read-only tool before you call it again.',
    }),
    storeRefused: defineError<{ message: string }>({
        code: 'mcp.admin-tools.store-refused',
        exit: 1,
        message: ({ message }) => `The Store MCP of the dev server refused the request: ${message}`,
    }),
    channelRefused: defineError<{ message: string }>({
        code: 'mcp.admin-tools.channel-refused',
        exit: 1,
        message: ({ message }) =>
            `The active channel was refused, so it was cleared and later calls use the default channel: ${message}`,
        fix: () => [
            {
                path: ['admin', 'list_channels'],
                input: {},
                description: 'List the channels and their tokens, then call admin_set_active_channel again',
            },
        ],
    }),
};
