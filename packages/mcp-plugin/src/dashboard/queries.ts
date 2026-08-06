/**
 * GraphQL documents and response types for the MCP Server dashboard page.
 *
 * These are plain-string documents passed to `api.query` / `api.mutate`. The
 * response shapes below mirror the Admin API SDL declared in
 * `src/api/api-extensions.ts`.
 */

export interface McpToolInfo {
    id: string;
    name: string;
    toolset: string;
    description: string;
    pluginSource: string;
    behavior: string;
    enabled: boolean;
}

export interface McpOauthGrantInfo {
    id: string;
    createdAt: string;
    updatedAt: string;
    actorId: string | null;
    actorType: string | null;
    channelId: string | null;
    oauthClientName: string | null;
    lastActivityAt: string;
    expiresAt: string;
}

export interface McpToolCallLog {
    id: string;
    createdAt: string;
    grantId: string | null;
    actor: string | null;
    actorType: string;
    channelId: string | null;
    toolName: string;
    pluginSource: string | null;
    durationMs: number | null;
    status: string;
}

export interface McpToolCallLogList {
    items: McpToolCallLog[];
    totalItems: number;
}

export interface McpTopTool {
    toolName: string;
    count: number;
}

export interface McpStats {
    totalCalls: number;
    successRate: number;
    errorRate: number;
    p50LatencyMs: number | null;
    p95LatencyMs: number | null;
    callsPerHour: number;
    topTools: McpTopTool[];
}

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
    query McpOauthGrants {
        mcpOauthGrants {
            id
            createdAt
            updatedAt
            actorId
            actorType
            channelId
            oauthClientName
            lastActivityAt
            expiresAt
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
