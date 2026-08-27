/**
 * Keep this file free of imports. The dashboard consent page reads it in the browser, and
 * `constants.ts` will not load there because it builds a `CrudPermissionDefinition` from
 * `@vendure/core`.
 */
export const OAUTH_ENDPOINT_PATHS = {
    register: 'mcp/oauth/register',
    authorize: 'mcp/oauth/authorize',
    authorizationRequest: 'mcp/oauth/authorization-request',
    token: 'mcp/oauth/token',
    revoke: 'mcp/oauth/revoke',
} as const;
