import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import { GraphQLResolveInfo } from 'graphql';

import { Collection } from '../../entity/collection/collection.entity';

import { isFieldInSelection } from './is-field-in-selection';

/**
 * Returns the ids of the Collections in a paginated list query whose `productVariantCount`
 * is requested, so that they can be counted with a single query. This covers the list items
 * and their loaded children. Returns `undefined` if no `productVariantCount` is requested.
 */
export function getVariantCountCollectionIds(
    info: GraphQLResolveInfo,
    items: Collection[],
): ID[] | undefined {
    const itemCountsRequested = isFieldInSelection(info, 'productVariantCount');
    const childCountsRequested = isFieldInSelection(info, 'productVariantCount', ['items', 'children']);
    if (!itemCountsRequested && !childCountsRequested) {
        return;
    }
    return unique(
        items.flatMap(c => [
            ...(itemCountsRequested ? [c.id] : []),
            ...(childCountsRequested ? (c.children ?? []).map(ch => ch.id) : []),
        ]),
    );
}
