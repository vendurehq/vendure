import { ID, RequestContext, TransactionalConnection } from '@vendure/core';

import { McpToolCallLog } from '../../src/entities/mcp-tool-call-log.entity';

/**
 * Forces a tool-call log row's `createdAt` to an explicit time. `createdAt` is only auto-set on
 * insert, so ageing a seeded row takes its own UPDATE.
 */
export async function backdateLogCreatedAt(
    connection: TransactionalConnection,
    ctx: RequestContext,
    id: ID,
    createdAt: Date,
): Promise<void> {
    await connection
        .getRepository(ctx, McpToolCallLog)
        .createQueryBuilder()
        .update()
        .set({ createdAt })
        .where('id = :id', { id })
        .execute();
}
