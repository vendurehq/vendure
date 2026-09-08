/** Keep this file free of imports: the dashboard consent page reads it in the browser, where `constants.ts` can't load because it pulls in `@vendure/core`. */
export const OAUTH_ENDPOINT_PATHS = {
    register: 'mcp/oauth/register',
    authorize: 'mcp/oauth/authorize',
    authorizationRequest: 'mcp/oauth/authorization-request',
    token: 'mcp/oauth/token',
    revoke: 'mcp/oauth/revoke',
} as const;
