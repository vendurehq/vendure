import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as listHelpers from './list-helpers';

const expectedExports = [
    'MAX_LIST_PAGE_SIZE',
    'ORDER_DETAIL_RELATIONS',
    'ORDER_LIST_RELATIONS',
    'ORDER_SORT_FIELDS',
    'booleanFilter',
    'dateFilter',
    'listOptions',
    'numberFilter',
    'orderListOptions',
    'page',
    'paginationFields',
    'productSearchWords',
    'publicCollectionListOptions',
    'publicProductListOptions',
    'slicePage',
    'stringFilter',
    'translateLineVariants',
];

describe('built-in list helpers', () => {
    it('exports only the helpers consumed by the shipped tools', () => {
        expect(Object.keys(listHelpers).sort()).toEqual(expectedExports);
        // The exports that are not functions: the sortable Order fields the list_orders tool turns
        // into its sortBy enum, the relations the order list and single-order tools load, the
        // page-size cap, and the four filter operator schemas the filterable list tools build their
        // filter objects from.
        const {
            ORDER_SORT_FIELDS,
            ORDER_LIST_RELATIONS,
            ORDER_DETAIL_RELATIONS,
            MAX_LIST_PAGE_SIZE,
            stringFilter,
            dateFilter,
            numberFilter,
            booleanFilter,
            ...helpers
        } = listHelpers;
        expect(Object.values(helpers).every(value => typeof value === 'function')).toBe(true);
        expect(ORDER_SORT_FIELDS).toEqual(['orderPlacedAt', 'updatedAt', 'createdAt', 'total']);
        expect(MAX_LIST_PAGE_SIZE).toBe(100);
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

    it('forwards a filter to core and leaves the key out when there is none', () => {
        const paged = listHelpers.listOptions({ limit: 5 });
        expect(paged).toEqual({ take: 5, skip: 0 });
        expect(Object.keys(paged)).not.toContain('filter');
        expect(
            listHelpers.listOptions({ offset: 10, filter: { emailAddress: { eq: 'jane@example.test' } } }),
        ).toEqual({
            take: 25,
            skip: 10,
            filter: { emailAddress: { eq: 'jane@example.test' } },
        });
    });

    it('carries an order filter and the sort together', () => {
        expect(
            listHelpers.orderListOptions({
                filter: { state: { eq: 'ArrangingPayment' } },
                sortBy: 'updatedAt',
            }),
        ).toEqual({
            take: 25,
            skip: 0,
            filter: { state: { eq: 'ArrangingPayment' } },
            sort: { updatedAt: 'DESC' },
        });
    });

    it('turns an ISO date-time into a Date and refuses anything else', () => {
        // Core writes a Date out in the format its database expects but passes a string through
        // untouched, so the filter has to hand it a Date.
        const parsed = listHelpers.dateFilter.parse({ before: '2026-01-02T00:00:00.000Z' });
        expect(parsed.before).toBeInstanceOf(Date);
        expect(parsed.before?.toISOString()).toBe('2026-01-02T00:00:00.000Z');
        expect(listHelpers.dateFilter.safeParse({ before: 'yesterday' }).success).toBe(false);
        expect(listHelpers.dateFilter.safeParse({ before: '2026-01-02' }).success).toBe(false);
    });

    it('accepts only whole page sizes from one to the cap', () => {
        const schema = z.strictObject(listHelpers.paginationFields('widgets'));
        const accepts = (input: Record<string, number>) => schema.safeParse(input).success;
        expect(accepts({})).toBe(true);
        expect(accepts({ limit: 1 })).toBe(true);
        expect(accepts({ limit: 100 })).toBe(true);
        expect(accepts({ offset: 0 })).toBe(true);
        // A limit of 0 used to reach core, which reads a falsy take as "no limit" and returns
        // every row; 101 used to come back as an untranslated error key.
        expect(accepts({ limit: 0 })).toBe(false);
        expect(accepts({ limit: -1 })).toBe(false);
        expect(accepts({ limit: 101 })).toBe(false);
        expect(accepts({ limit: 1.5 })).toBe(false);
        // A negative offset was clamped to 0 by core while hasMore was still computed from the
        // raw value, so the list claimed there was always another page.
        expect(accepts({ offset: -1 })).toBe(false);
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
        expect(trimmed('cameras bags shoes')).toEqual(['camera', 'bag', 'shoe']);
        expect(trimmed('boxes watches dresses lenses')).toEqual(['box', 'watch', 'dress', 'lens']);
        expect(trimmed('glass class gas bus')).toEqual(['glass', 'class', 'gas', 'bus']);
        expect(trimmed('camera folding')).toEqual(['camera', 'folding']);
        // A singular noun ending in one "s" is over-trimmed. Trimming the end of a word can only
        // widen a substring match, so "len" still finds "Lens", and this pass runs only after the
        // words as typed have already found nothing.
        expect(trimmed('lens')).toEqual(['len']);
    });
});
