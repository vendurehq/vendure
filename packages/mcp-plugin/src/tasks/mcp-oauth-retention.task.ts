import { ScheduledTask } from '@vendure/core';

import { McpOauthRetentionService } from '../oauth/oauth-retention.service';

/**
 * @description
 * A {@link ScheduledTask} that deletes MCP OAuth records which can no longer be used: the Vendure
 * session created for each expired grant, authorization requests and codes that have expired,
 * grants that have been dead longer than the `oauth.grantRetentionDays` window, and clients that
 * were created but never used and have no grant referencing them. The schedule defaults to daily
 * at 03:30AM.
 */
export const mcpOauthRetentionTask = new ScheduledTask({
    id: 'mcp-oauth-retention',
    description: 'Deletes expired MCP OAuth records',
    schedule: cron => cron.everyDayAt(3, 30),
    params: {},
    async execute({ injector, scheduledContext }) {
        return injector.get(McpOauthRetentionService).deleteExpiredOauthRecords(scheduledContext);
    },
});
