import { graphql } from '@/gql';

/**
 * Every request the MCP Server dashboard page sends. The Admin API schema supplies the reply
 * and variable types, so a change to `src/api/api-extensions.ts` that these requests do not
 * match stops the dashboard code compiling.
 */

export const mcpToolsQuery = graphql(`
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
`);

export const mcpServerConfigQuery = graphql(`
    query McpServerConfig {
        mcpServerConfig {
            toolExposure
            shopAccess
            oauthConfigured
            issuer
        }
    }
`);

export const mcpStatsQuery = graphql(`
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
`);

export const mcpToolCallLogsQuery = graphql(`
    query McpToolCallLogs($options: McpToolCallLogListOptions) {
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
            }
            totalItems
        }
    }
`);

export const mcpOauthGrantsQuery = graphql(`
    query McpOauthGrants($options: McpOauthGrantListOptions) {
        mcpOauthGrants(includeInactive: true, options: $options) {
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
`);

export const setMcpToolEnabledDocument = graphql(`
    mutation SetMcpToolEnabled($toolName: String!, $toolset: McpToolset!, $enabled: Boolean!) {
        setMcpToolEnabled(toolName: $toolName, toolset: $toolset, enabled: $enabled) {
            name
            toolset
            enabled
        }
    }
`);

export const revokeMcpOauthGrantDocument = graphql(`
    mutation RevokeMcpOauthGrant($id: ID!) {
        revokeMcpOauthGrant(id: $id)
    }
`);

export const authorizeMcpClientDocument = graphql(`
    mutation AuthorizeMcpClient($requestToken: String!, $approved: Boolean!) {
        authorizeMcpClient(requestToken: $requestToken, approved: $approved) {
            redirectUrl
        }
    }
`);
