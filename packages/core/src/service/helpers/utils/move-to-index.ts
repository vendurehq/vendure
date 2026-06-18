import { Orderable } from '../../../common/types/common-types';
import { idsAreEqual } from '../../../common/utils';
import { VendureEntity } from '../../../entity/base/base.entity';

/**
 * Moves the target Orderable entity to the given index amongst its siblings.
 * Returns the siblings (including the target) which should then be
 * persisted to the database.
 */
export function moveToIndex<T extends Orderable & VendureEntity>(
    index: number,
    target: T,
    siblings: T[],
): T[] {
    const normalizedIndex = Math.max(Math.min(index, siblings.length), 0);
    let currentIndex = siblings.findIndex(sibling => idsAreEqual(sibling.id, target.id));
    const orderedSiblings = [...siblings].sort((a, b) => (a.position > b.position ? 1 : -1));
    const siblingsWithTarget = currentIndex < 0 ? [...orderedSiblings, target] : [...orderedSiblings];
    currentIndex = siblingsWithTarget.findIndex(sibling => idsAreEqual(sibling.id, target.id));
    if (currentIndex !== normalizedIndex) {
        siblingsWithTarget.splice(normalizedIndex, 0, siblingsWithTarget.splice(currentIndex, 1)[0]);
    }
    // Always reassign positions to ensure consistency — the target item
    // may carry a stale position value from a different parent.
    siblingsWithTarget.forEach((collection, i) => {
        collection.position = i;
        if (target.id === collection.id) {
            target.position = i;
        }
    });
    return siblingsWithTarget;
}
