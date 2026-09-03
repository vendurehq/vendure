import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as listHelpers from './list-helpers';

const expectedExports = [
    'MAX_LIST_PAGE_SIZE',
    'booleanFilter',
    'dateFilter',
    'listOptions',
    'numberFilter',
    'page',
    'paginationFields',
    'slicePage',
    'stringFilter',
];

describe('built-in list helpers', () => {
    it('exports only the helpers consumed by the shipped tools', () => {
        expect(Object.keys(listHelpers).sort()).toEqual(expectedExports);
        // The exports that are not functions: the page-size cap, and the four filter operator
        // schemas the filterable list tools build their filter objects from.
        const { MAX_LIST_PAGE_SIZE, stringFilter, dateFilter, numberFilter, booleanFilter, ...helpers } =
            listHelpers;
        expect(Object.values(helpers).every(value => typeof value === 'function')).toBe(true);
        expect(MAX_LIST_PAGE_SIZE).toBe(100);
    });

    it('forwards a filter to core and leaves the key out when there is none', () => {
        const paged = listHelpers.listOptions({ limit: 5 });
        expect(paged).toEqual({ take: 5, skip: 0, sort: { createdAt: 'DESC', id: 'DESC' } });
        expect(Object.keys(paged)).not.toContain('filter');
        expect(
            listHelpers.listOptions({ offset: 10, filter: { emailAddress: { eq: 'jane@example.test' } } }),
        ).toEqual({
            take: 25,
            skip: 10,
            filter: { emailAddress: { eq: 'jane@example.test' } },
            sort: { createdAt: 'DESC', id: 'DESC' },
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
        // An offset above the GraphQL Int range reached the database as a number it cannot store.
        expect(accepts({ offset: 2147483647 })).toBe(true);
        expect(accepts({ offset: 2147483648 })).toBe(false);
    });

    it('caps the length and the count of the values a string filter carries', () => {
        const accepts = (input: Record<string, unknown>) => listHelpers.stringFilter.safeParse(input).success;
        expect(accepts({ contains: 'a'.repeat(255) })).toBe(true);
        expect(accepts({ contains: 'a'.repeat(256) })).toBe(false);
        expect(accepts({ eq: 'a'.repeat(256) })).toBe(false);
        expect(accepts({ in: Array.from({ length: 100 }, () => 'code') })).toBe(true);
        expect(accepts({ in: Array.from({ length: 101 }, () => 'code') })).toBe(false);
    });
});
