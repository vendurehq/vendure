import { ScheduledTask } from '@vendure/core';

import { McpToolCallLogRetentionService } from '../logging/mcp-tool-call-log-retention.service';

/**
 * @description
 * A {@link ScheduledTask} that deletes expired MCP tool-call logs — rows older than the configured
 * `logging.ttlDays` retention window. The schedule defaults to daily at 02:30AM.
 */
export const mcpToolCallLogRetentionTask = new ScheduledTask({
    id: 'mcp-tool-call-log-retention',
    description: 'Deletes expired MCP tool call logs',
    schedule: cron => cron.everyDayAt(2, 30),
    async execute({ injector, scheduledContext }) {
        const deletedCount = await injector
            .get(McpToolCallLogRetentionService)
            .deleteExpiredToolCallLogs(scheduledContext);
        return { deletedCount };
    },
});
