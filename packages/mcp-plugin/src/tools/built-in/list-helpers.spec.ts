import { describe, expect, it } from 'vitest';

import * as listHelpers from './list-helpers';

const expectedExports = [
    'ORDER_SORT_FIELDS',
    'listOptions',
    'orderListOptions',
    'page',
    'paginationFields',
    'publicCollectionListOptions',
    'publicProductListOptions',
    'slicePage',
];

describe('built-in list helpers', () => {
    it('exports only the helpers consumed by the shipped tools', () => {
        expect(Object.keys(listHelpers).sort()).toEqual(expectedExports);
        // Everything here is a helper function apart from ORDER_SORT_FIELDS, which is the list of
        // sortable Order fields that the list_orders tool turns into its sortBy enum.
        const { ORDER_SORT_FIELDS, ...helpers } = listHelpers;
        expect(Object.values(helpers).every(value => typeof value === 'function')).toBe(true);
        expect(ORDER_SORT_FIELDS).toEqual(['orderPlacedAt', 'updatedAt', 'createdAt', 'total']);
    });

    it('sorts orders by newest placed first unless asked otherwise', () => {
        expect(listHelpers.orderListOptions({})).toEqual({
            take: 25,
            skip: 0,
            sort: { orderPlacedAt: 'DESC' },
        });
        expect(
            listHelpers.orderListOptions({
                limit: 5,
                offset: 10,
                sortBy: 'total',
                sortDirection: 'ASC',
            }),
        ).toEqual({
            take: 5,
            skip: 10,
            sort: { total: 'ASC' },
        });
    });

    it('builds public product list options without losing the query filter', () => {
        expect(listHelpers.publicProductListOptions({ limit: 10, offset: 5, query: 'shoe' })).toEqual({
            take: 10,
            skip: 5,
            filter: {
                _or: [{ name: { contains: 'shoe' } }, { slug: { contains: 'shoe' } }],
                enabled: { eq: true },
            },
        });
    });
});
