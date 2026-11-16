import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import * as listHelpers from './list-helpers';

describe('list helpers', () => {
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
        // Core reads a take of 0 as "no limit" and would return every row.
        expect(accepts({ limit: 0 })).toBe(false);
        expect(accepts({ limit: -1 })).toBe(false);
        expect(accepts({ limit: 101 })).toBe(false);
        expect(accepts({ limit: 1.5 })).toBe(false);
        // Core clamps a negative offset to 0, but `page` would still compute hasMore from -1.
        expect(accepts({ offset: -1 })).toBe(false);
        // The database cannot store an offset above the GraphQL Int range.
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

    it('reports whether items remain after the page', () => {
        expect(listHelpers.page(['a', 'b'], 5, { offset: 2 }).hasMore).toBe(true);
        expect(listHelpers.page(['a'], 5, { offset: 4 }).hasMore).toBe(false);
        expect(listHelpers.page(['a', 'b'], 2, {})).toEqual({ items: ['a', 'b'], total: 2, hasMore: false });
    });

    it('slices 25 items when the input sets no limit', () => {
        const all = Array.from({ length: 30 }, (_, index) => index);
        expect(listHelpers.slicePage(all, {})).toEqual(all.slice(0, 25));
        expect(listHelpers.slicePage(all, { offset: 28, limit: 5 })).toEqual([28, 29]);
    });
});
