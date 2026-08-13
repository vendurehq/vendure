export const MCP_TOOL_CALL_LOGS_WITH_BODIES_QUERY = `
    query McpToolCallLogsWithBodies($options: McpToolCallLogListOptions) {
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
                channelId
                input
                output
                clientIp
            }
            totalItems
        }
    }
`;
