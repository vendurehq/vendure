import { ScheduledTask } from '@vendure/core';

import { McpOauthRetentionService } from '../oauth/oauth-retention.service';

/**
 * @description
 * A {@link ScheduledTask} that deletes MCP OAuth records which can no longer be used: the Vendure
 * session for each expired grant, expired authorization requests and codes, grants dead longer
 * than `oauth.grantRetentionDays`, and clients created but never used with no grant referencing
 * them. Defaults to running daily at 03:30AM.
 */
export const mcpOauthRetentionTask = new ScheduledTask({
    id: 'mcp-oauth-retention',
    description: 'Deletes expired MCP OAuth records',
    schedule: cron => cron.everyDayAt(3, 30),
    async execute({ injector, scheduledContext }) {
        return injector.get(McpOauthRetentionService).deleteExpiredOauthRecords(scheduledContext);
    },
});
