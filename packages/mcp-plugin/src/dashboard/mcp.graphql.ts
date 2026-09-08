import { graphql } from '@/gql';

// A mismatch with src/api/api-extensions.ts stops the dashboard code compiling.

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

export const setMcpToolEnabledMutation = graphql(`
    mutation SetMcpToolEnabled($toolName: String!, $toolset: McpToolset!, $enabled: Boolean!) {
        setMcpToolEnabled(toolName: $toolName, toolset: $toolset, enabled: $enabled) {
            enabled
        }
    }
`);

export const revokeMcpOauthGrantMutation = graphql(`
    mutation RevokeMcpOauthGrant($id: ID!) {
        revokeMcpOauthGrant(id: $id)
    }
`);

export const authorizeMcpClientMutation = graphql(`
    mutation AuthorizeMcpClient($requestToken: String!, $approved: Boolean!) {
        authorizeMcpClient(requestToken: $requestToken, approved: $approved) {
            redirectUrl
        }
    }
`);
