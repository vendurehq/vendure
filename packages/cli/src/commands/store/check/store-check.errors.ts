import { defineError } from '@vendure/common/lib/command';

export const storeCheckErrors = {
    notAuthorized: defineError<Record<string, never>>({
        code: 'store.check.not-authorized',
        exit: 1,
        message: () =>
            'The Admin API did not accept the credential of the vendure dev run. Only the McpPlugin ' +
            'accepts it, with its local trust on. Most often the Vendure config has no ' +
            '`McpPlugin.init({})` from `@vendure/mcp-plugin`, or passes `localTrust: false` to ' +
            '`McpPlugin.init()`. When the McpPlugin turns local trust off, it logs why at startup.',
        fix: () => [
            {
                path: ['devserver', 'logs'],
                input: { minSeverity: 'warn' },
                description: 'Read the startup warning that says why local trust is off',
            },
        ],
    }),
    notSupported: defineError<Record<string, never>>({
        code: 'store.check.not-supported',
        exit: 1,
        message: () =>
            'The dev server has no storeReadiness query. It runs a version of @vendure/core without the store check.',
    }),
    queryFailed: defineError<{ message: string; requestId?: string }>({
        code: 'store.check.query-failed',
        exit: 1,
        message: ({ message, requestId }) =>
            `The storeReadiness query failed: ${message}${requestId ? ` (request ID ${requestId})` : ''}`,
        fix: ({ requestId }) =>
            requestId
                ? [
                      {
                          path: ['devserver', 'logs'],
                          input: { request: requestId },
                          description: 'Read the server logs of the request',
                      },
                  ]
                : [],
    }),
};
