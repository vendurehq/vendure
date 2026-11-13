import { ID } from '@vendure/common/lib/shared-types';

const numericId = /^\d+$/;

/**
 * Orders ProductVariant ids for taking StockLevel row locks. Every code path which locks the
 * StockLevels of more than one variant in a transaction must visit them in this order, so two
 * transactions never take the same locks in opposite order and deadlock.
 *
 * Numeric ids compare by value (`9` before `10`), without converting to a number, so ids
 * beyond `Number.MAX_SAFE_INTEGER` keep their order. Any other id (e.g. a UUID) compares as a
 * plain string. A single database uses one id strategy, so the two kinds are never mixed.
 */
export function compareIdsForLockOrder(a: ID, b: ID): number {
    const idA = String(a);
    const idB = String(b);
    if (numericId.test(idA) && numericId.test(idB) && idA.length !== idB.length) {
        return idA.length - idB.length;
    }
    return idA < idB ? -1 : idA > idB ? 1 : 0;
}
