import { Type } from '@vendure/common/lib/shared-types';

import { ActiveOrderStrategy } from '../order/active-order-strategy';

import { getStrategyChain } from './strategy-chain';

/**
 * The priorities of the entries that `addStrategyToList()` added. The data is kept on the entries
 * and not on the array, because `mergeConfig()` copies arrays.
 */
const listPriorities = new WeakMap<object, number>();

/**
 * Records that `removeStrategyFromList()` removed an entry class. It is a valid entry that does
 * nothing, so code that reads the list before core sorts it does not fail.
 */
export class RemovedStrategyListEntry implements ActiveOrderStrategy {
    readonly name: string;

    constructor(readonly removed: Type<unknown>) {
        this.name = `removed:${removed.name}`;
    }

    determineActiveOrder() {
        return Promise.resolve(undefined);
    }
}

export function toArray<S>(list: S | S[]): S[] {
    return Array.isArray(list) ? list : [list];
}

/**
 * Returns the priority of a list entry. An entry that `addStrategyToList()` did not add has
 * the priority 0.
 */
export function getListEntryPriority(entry: object): number {
    return listPriorities.get(entry) ?? 0;
}

/**
 * Returns the class that identifies a list entry. For a composed entry, this is the class of its
 * base strategy.
 */
export function getListEntryClass(entry: object): Type<unknown> {
    return (getStrategyChain(entry)?.base ?? entry).constructor as Type<unknown>;
}

export function setListEntryPriority(entry: object, priority: number) {
    listPriorities.set(entry, priority);
}

/**
 * Returns `true` if `addStrategyToList()` added the entry.
 */
export function hasListEntryPriority(entry: object): boolean {
    return listPriorities.has(entry);
}

/**
 * Returns the list with the removed entries filtered out, sorted by priority. The removal records
 * stay at the end, so a second run of the `configuration` functions gives the same list.
 */
export function sortStrategyList<S extends object>(list: S[]): S[] {
    const markers = list.filter(
        e => e instanceof RemovedStrategyListEntry,
    ) as unknown as RemovedStrategyListEntry[];
    const removed = markers.map(m => m.removed);
    const entries = list
        .filter(e => !(e instanceof RemovedStrategyListEntry) && !removed.includes(getListEntryClass(e)))
        .sort((a, b) => getListEntryPriority(a) - getListEntryPriority(b));
    return [...entries, ...(markers as unknown as S[])];
}
