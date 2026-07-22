import { isObject } from '@vendure/common/lib/shared-utils';

import { safeAssign } from '../../../common/safe-assign';

/**
 * Merges properties into a target entity. This is needed for the cases in which a
 * property already exists on the target, but the hydrated version also contains that
 * property with a different set of properties. This prevents the original target
 * entity from having data overwritten.
 */
export function mergeDeep<T extends { [key: string]: any }>(
    a: T | undefined,
    b: T,
    visited: WeakSet<object> = new WeakSet(),
): T {
    if (!a) {
        return b;
    }

    // Track only the current recursion path, not every source object seen during the
    // whole merge. A source object shared by multiple targets (e.g. two order lines
    // referencing the same ProductVariant) is not a circular reference — it must be
    // merged into every referencing target. We add `b` on the way in and remove it on
    // the way out, so a genuine self-referential cycle is still caught (it is still on
    // the path when re-encountered) while a shared instance is not. See #4935.
    let addedToPath = false;
    if (isObject(b)) {
        if (visited.has(b)) {
            return a;
        }
        visited.add(b);
        addedToPath = true;
    }

    if (Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.length > 1) {
        // Only attempt id-based reordering when both arrays are fully populated with
        // entities. A relation array can legitimately contain `undefined` holes (e.g.
        // surcharges/payments/shippingLines on an Order after OrderPlacedEvent); the
        // reordering below dereferences every element (`.hasOwnProperty`, `.id`), so a
        // hole would throw and crash EntityHydrator.hydrate() — silently dropping the
        // order-confirmation email when hydrate() is called from an EmailPlugin loadData
        // handler. When there are holes we skip reordering and fall through to the
        // index-based merge below, which handles `undefined` entries safely. See #4955.
        if (a.every(item => item != null) && b.every(item => item != null) && a[0].hasOwnProperty('id')) {
            // If the array contains entities, we can use the id to match them up
            // so that we ensure that we don't merge properties from different entities
            // with the same index.
            const aIds = a.map(e => e.id);
            const bIds = b.map(e => e.id);
            if (JSON.stringify(aIds) !== JSON.stringify(bIds)) {
                // The entities in the arrays are not in the same order, so we can't
                // safely merge them. We need to sort the `b` array so that the entities
                // are in the same order as the `a` array.
                const idToIndexMap = new Map();
                a.forEach((item, index) => {
                    idToIndexMap.set(item.id, index);
                });
                b.sort((_a, _b) => {
                    return idToIndexMap.get(_a.id) - idToIndexMap.get(_b.id);
                });
            }
        }
    }

    for (const [key, value] of Object.entries(b)) {
        // Guard against prototype pollution - block dangerous property names
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }

        if (Object.getOwnPropertyDescriptor(b, key)?.writable) {
            if (Array.isArray(value) || isObject(value)) {
                // Skip if we detect a circular reference
                if (isObject(value) && visited.has(value)) {
                    continue;
                }
                // Only merge recursively if the property exists as an own property in the destination object
                if (
                    Object.prototype.hasOwnProperty.call(a, key) &&
                    (Array.isArray(a[key]) || isObject(a[key]))
                ) {
                    const mergedValue = mergeDeep(a[key], b[key], visited);
                    safeAssign(a, key, mergedValue);
                } else {
                    safeAssign(a, key, value);
                }
            } else {
                safeAssign(a, key, value);
            }
        }
    }

    if (addedToPath) {
        visited.delete(b);
    }

    return a ?? b;
}
