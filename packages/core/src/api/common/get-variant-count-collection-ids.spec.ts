import { GraphQLResolveInfo, Kind, SelectionNode } from 'graphql';
import { describe, expect, it } from 'vitest';

import { Collection } from '../../entity/collection/collection.entity';

import { getVariantCountCollectionIds } from './get-variant-count-collection-ids';

function field(name: string, selections?: SelectionNode[]): SelectionNode {
    return {
        kind: Kind.FIELD,
        name: { kind: Kind.NAME, value: name },
        selectionSet: selections && { kind: Kind.SELECTION_SET, selections },
    };
}

/**
 * Creates a mock GraphQLResolveInfo for `collections { items { ...itemSelections } }`
 */
function createMockResolveInfo(itemSelections: SelectionNode[]): GraphQLResolveInfo {
    return {
        fieldNodes: [field('collections', [field('items', itemSelections)])],
        fragments: {},
    } as unknown as GraphQLResolveInfo;
}

const items = [
    { id: 1, children: [{ id: 2 }, { id: 3 }] },
    { id: 2, children: [] },
] as unknown as Collection[];

describe('getVariantCountCollectionIds', () => {
    it('returns undefined when productVariantCount is not requested', () => {
        const info = createMockResolveInfo([field('id'), field('children', [field('id')])]);
        expect(getVariantCountCollectionIds(info, items)).toBeUndefined();
    });

    it('returns only item ids when children counts are not requested', () => {
        const info = createMockResolveInfo([field('productVariantCount'), field('children', [field('id')])]);
        expect(getVariantCountCollectionIds(info, items)).toEqual([1, 2]);
    });

    it('returns only children ids when only children counts are requested', () => {
        const info = createMockResolveInfo([field('id'), field('children', [field('productVariantCount')])]);
        expect(getVariantCountCollectionIds(info, items)).toEqual([2, 3]);
    });

    it('returns unique item and children ids when both are requested', () => {
        const info = createMockResolveInfo([
            field('productVariantCount'),
            field('children', [field('productVariantCount')]),
        ]);
        expect(getVariantCountCollectionIds(info, items)).toEqual([1, 2, 3]);
    });
});
