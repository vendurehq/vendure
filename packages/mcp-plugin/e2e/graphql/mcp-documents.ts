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

export const MCP_SERVER_CONFIG_QUERY = `
    query McpServerConfig {
        mcpServerConfig {
            toolExposure
            shopAccess
            oauthConfigured
            issuer
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

/**
 * Every field of a log row, bodies and client IP included. Requesting them needs no extra
 * permission: a caller without `ReadCustomer` receives nulls for `input`, `output` and `clientIp`
 * rather than an error, which is what `logging.e2e-spec.ts` asserts. So this one document serves
 * both the tests that read the bodies and the tests that only read metadata.
 */
export const MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY = `
    query McpToolCallLogsWithBodies($options: McpToolCallLogListOptions) {
        mcpToolCallLogs(options: $options) {
            items {
                id
                createdAt
                toolName
                actor
                actorType
                actorName
                customerId
                status
                durationMs
                pluginSource
                channelId
                input
                output
                clientIp
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
                actorName
                customerId
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
    mutation SetMcpToolEnabled($toolName: String!, $toolset: McpToolset!, $enabled: Boolean!) {
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
