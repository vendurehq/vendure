import { ColumnFiltersState } from '@tanstack/react-table';
import { describe, expect, it } from 'vitest';

import { columnFiltersEqual } from './data-table-column-filters.js';

describe('columnFiltersEqual', () => {
    const filters: ColumnFiltersState = [{ id: 'isArchived', value: { eq: false } }];

    it('treats a re-rendered copy of the same filters as unchanged', () => {
        // The DataTable reports a filter change by persisting it, so an initial render — or any
        // re-render that hands over an equivalent array — must not look like a user edit.
        expect(columnFiltersEqual(filters, [{ id: 'isArchived', value: { eq: false } }])).toBe(true);
    });

    it('treats two empty filter states as unchanged', () => {
        expect(columnFiltersEqual([], [])).toBe(true);
    });

    it('treats clearing all filters as a change', () => {
        // The counterpart to the above: going from some filters to none is a deliberate user
        // action and must be reported, so that it can be persisted as "cleared".
        expect(columnFiltersEqual(filters, [])).toBe(false);
    });

    it('treats a changed filter value as a change', () => {
        expect(columnFiltersEqual(filters, [{ id: 'isArchived', value: { eq: true } }])).toBe(false);
    });

    it('treats an added filter as a change', () => {
        expect(columnFiltersEqual([], filters)).toBe(false);
    });
});
