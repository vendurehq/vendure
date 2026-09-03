import { ID, RequestContext, TransactionalConnection } from '@vendure/core';
import { ObjectLiteral, ObjectType } from 'typeorm';

import { RETENTION_DELETE_BATCH_SIZE } from './constants';

/**
 * Deletes rows from `entity` by id, one batch at a time: `selectBatch` returns at most a
 * batch of ids, and the loop ends when a short batch comes back. Both retention sweeps use it,
 * which keeps each statement small enough not to lock a large table.
 */
export async function deleteInBatches<R extends { id: ID }>(
    connection: TransactionalConnection,
    ctx: RequestContext,
    entity: ObjectType<ObjectLiteral>,
    selectBatch: () => Promise<R[]>,
    afterDelete?: (rows: R[]) => Promise<void>,
): Promise<number> {
    const repository = connection.getRepository(ctx, entity);
    let totalDeleted = 0;
    for (;;) {
        const rows = await selectBatch();
        if (rows.length === 0) {
            break;
        }
        const result = await repository
            .createQueryBuilder()
            .delete()
            .where('id IN (:...ids)', { ids: rows.map(row => row.id) })
            .execute();
        await afterDelete?.(rows);
        totalDeleted += result.affected ?? rows.length;
        if (rows.length < RETENTION_DELETE_BATCH_SIZE) {
            break;
        }
    }
    return totalDeleted;
}
