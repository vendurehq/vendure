import { describe, expect, it } from 'vitest';

import * as listHelpers from './list-helpers';

const expectedExports = [
    'ORDER_SORT_FIELDS',
    'listOptions',
    'orderListOptions',
    'page',
    'paginationFields',
    'productSearchWords',
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

    it('requires every search word to match the product name or slug', () => {
        expect(listHelpers.publicProductListOptions({ limit: 10, offset: 5 }, ['camera', 'bag'])).toEqual({
            take: 10,
            skip: 5,
            filter: {
                enabled: { eq: true },
                _and: [
                    { _or: [{ name: { contains: 'camera' } }, { slug: { contains: 'camera' } }] },
                    { _or: [{ name: { contains: 'bag' } }, { slug: { contains: 'bag' } }] },
                ],
            },
        });
    });

    it('drops the word filter entirely when nothing was searched for', () => {
        // An empty _and would produce an empty bracket in the SQL, so it has to be left out.
        expect(listHelpers.publicProductListOptions({})).toEqual({
            take: 25,
            skip: 0,
            filter: { enabled: { eq: true } },
        });
    });

    it('splits a query into words and leaves them as typed by default', () => {
        expect(listHelpers.productSearchWords('  Camera   Bags ')).toEqual(['Camera', 'Bags']);
        expect(listHelpers.productSearchWords(undefined)).toEqual([]);
        expect(listHelpers.productSearchWords('   ')).toEqual([]);
    });

    it('trims plural endings only when asked to', () => {
        const trimmed = (query: string) => listHelpers.productSearchWords(query, true);
        // Plain plurals lose the trailing "s".
        expect(trimmed('cameras bags shoes')).toEqual(['camera', 'bag', 'shoe']);
        // "es" plurals after s, x, z, ch and sh lose both letters.
        expect(trimmed('boxes watches dresses lenses')).toEqual(['box', 'watch', 'dress', 'lens']);
        // Singular words that end in "ss", and words under four characters, are left alone.
        expect(trimmed('glass class gas bus')).toEqual(['glass', 'class', 'gas', 'bus']);
        // Words with no plural ending come back untouched.
        expect(trimmed('camera folding')).toEqual(['camera', 'folding']);
        // A singular noun ending in one "s" is over-trimmed. Trimming the end of a word can only
        // widen a substring match, so "len" still finds "Lens", and this pass runs only after the
        // words as typed have already found nothing.
        expect(trimmed('lens')).toEqual(['len']);
    });
});
