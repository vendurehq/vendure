import { Inject, Injectable } from '@nestjs/common';
import { ID, RequestContext, TransactionalConnection } from '@vendure/core';

import { MCP_PLUGIN_OPTIONS, MS_PER_DAY, RETENTION_DELETE_BATCH_SIZE } from '../constants';
import { deleteInBatches } from '../delete-in-batches';
import { McpToolCallLog } from '../entities/mcp-tool-call-log.entity';
import { ResolvedMcpPluginOptions } from '../internal-types';

/**
 * Deletes tool-call log rows older than the configured `logging.ttlDays` window, in batches so a
 * large table is never locked by one statement. Used by the scheduled retention task and by the
 * admin mutation that prunes on demand.
 */
@Injectable()
export class McpToolCallLogRetentionService {
    constructor(
        private connection: TransactionalConnection,
        @Inject(MCP_PLUGIN_OPTIONS) private options: ResolvedMcpPluginOptions,
    ) {}

    async deleteExpiredToolCallLogs(ctx: RequestContext, channelId?: ID | null): Promise<number> {
        const ttlDays = this.options.logging.ttlDays;
        if (ttlDays === 0) {
            return 0;
        }
        const cutoff = new Date(Date.now() - ttlDays * MS_PER_DAY);
        return deleteInBatches(this.connection, ctx, McpToolCallLog, () => {
            const query = this.connection
                .getRepository(ctx, McpToolCallLog)
                .createQueryBuilder('log')
                .select('log.id', 'id')
                .where('log.createdAt < :cutoff', { cutoff })
                .limit(RETENTION_DELETE_BATCH_SIZE);
            if (channelId != null) {
                // A channel only ever prunes its own rows, matching what it can see in the
                // dashboard log list.
                query.andWhere('log.channelId = :channelId', { channelId });
            }
            return query.getRawMany<{ id: ID }>();
        });
    }
}
