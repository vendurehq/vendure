import { Type } from '@vendure/common/lib/shared-types';

import { ActiveOrderStrategy } from '../order/active-order-strategy';

import { assertValidPriority } from './strategy-chain';
import {
    getListEntryClass,
    RemovedStrategyListEntry,
    setListEntryPriority,
    toArray,
} from './strategy-list-entries';

/**
 * @description
 * Adds an entry to a strategy list option and returns the new list. Use it in place of
 * a new array. In 4.0 this applies to `orderOptions.activeOrderStrategy`.
 *
 * Core sorts the list by priority after the `configuration` functions of all plugins have run.
 * An entry with a lower number is called first. An entry that this function did not add, for example
 * an entry of the array in the project config, has the priority 0 and keeps its position relative to
 * the other entries with priority 0. Use a negative priority to call an entry before them.
 *
 * The class of an entry is its identity. For an entry with layers, the class of its base strategy
 * is the identity. If the list has an entry of the same class, the list does not change.
 *
 * @example
 * ```ts
 * config.orderOptions.activeOrderStrategy = addStrategyToList(
 *     config.orderOptions.activeOrderStrategy,
 *     new TokenActiveOrderStrategy(),
 *     { priority: -100 },
 * );
 * ```
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage addStrategyToList
 */
export function addStrategyToList<S extends ActiveOrderStrategy<any>>(
    list: S | S[],
    entry: S,
    options?: { priority?: number },
): S[] {
    const priority = options?.priority ?? 0;
    assertValidPriority(priority);
    const entries = toArray(list);
    const entryClass = getListEntryClass(entry);
    if (entries.some(e => getListEntryClass(e) === entryClass)) {
        return entries;
    }
    setListEntryPriority(entry, priority);
    return [...entries, entry];
}

/**
 * @description
 * Records that the list must not contain an entry of the given class, and returns the new list.
 * Core applies the removal after the `configuration` functions of all plugins have run, so the
 * removal also applies to an entry that a plugin adds later. Thus a project can remove the entry of
 * a plugin, or the default entry, in the project config.
 *
 * @example
 * ```ts
 * // vendure-config.ts
 * orderOptions: {
 *     activeOrderStrategy: removeStrategyFromList(
 *         defaultConfig.orderOptions.activeOrderStrategy,
 *         DefaultActiveOrderStrategy,
 *     ),
 * },
 * ```
 *
 * @since 4.0.0
 * @docsCategory configuration
 * @docsPage addStrategyToList
 */
export function removeStrategyFromList<S extends ActiveOrderStrategy<any>>(
    list: S | S[],
    entryClass: Type<S>,
): S[] {
    const entries = toArray(list);
    if (entries.some(e => e instanceof RemovedStrategyListEntry && e.removed === entryClass)) {
        return entries;
    }
    return [...entries, new RemovedStrategyListEntry(entryClass) as unknown as S];
}
