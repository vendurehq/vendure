/**
 * The Admin API requests the end-to-end tests send, as plain strings.
 *
 * `src/dashboard/mcp.graphql.ts` holds the same requests in a wrapper that takes their types
 * from the schema. The end-to-end test runner resolves no path aliases, so it cannot reach
 * `@/gql` and cannot load that wrapper. Tests keep their own copies, the same way
 * `packages/core/e2e/graphql/` does.
 */

export const MCP_TOOLS_QUERY = `
    query McpTools {
        mcpTools {
            id
            name
            toolset
            description
            pluginSource
            behavior
            enabled
        }
    }
`;

export const MCP_STATS_QUERY = `
    query McpStats($timeRange: String) {
        mcpStats(timeRange: $timeRange) {
            totalCalls
            successRate
            errorRate
            p50LatencyMs
            p95LatencyMs
            callsPerHour
            topTools {
                toolName
                count
            }
        }
    }
`;

export const MCP_TOOL_CALL_LOGS_QUERY = `
    query McpToolCallLogs($options: McpToolCallLogListOptions) {
        mcpToolCallLogs(options: $options) {
            items {
                id
                createdAt
                toolName
                actor
                actorType
                status
                durationMs
                pluginSource
            }
            totalItems
        }
    }
`;

export const MCP_OAUTH_GRANTS_QUERY = `
    query McpOauthGrants($includeInactive: Boolean!, $options: McpOauthGrantListOptions) {
        mcpOauthGrants(includeInactive: $includeInactive, options: $options) {
            items {
                id
                createdAt
                updatedAt
                actorId
                actorType
                channelId
                oauthClientName
                lastActivityAt
                expiresAt
                revokedAt
                status
            }
            totalItems
        }
    }
`;

export const SET_MCP_TOOL_ENABLED = `
    mutation SetMcpToolEnabled($toolName: String!, $toolset: String!, $enabled: Boolean!) {
        setMcpToolEnabled(toolName: $toolName, toolset: $toolset, enabled: $enabled) {
            name
            toolset
            enabled
        }
    }
`;

export const REVOKE_MCP_OAUTH_GRANT = `
    mutation RevokeMcpOauthGrant($id: ID!) {
        revokeMcpOauthGrant(id: $id)
    }
`;

export const AUTHORIZE_MCP_CLIENT = `
    mutation AuthorizeMcpClient($requestToken: String!, $approved: Boolean!) {
        authorizeMcpClient(requestToken: $requestToken, approved: $approved) {
            redirectUrl
        }
    }
`;
