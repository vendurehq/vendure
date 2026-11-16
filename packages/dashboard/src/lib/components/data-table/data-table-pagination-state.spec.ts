import { describe, expect, it } from 'vitest';
import { createPaginationState, syncPaginationState } from './data-table-pagination-state.js';

describe('data table pagination state', () => {
    it('synchronizes a changed page-size prop after initialization', () => {
        const initial = createPaginationState(1, 24);

        expect(syncPaginationState(initial, 1, 10)).toEqual({ pageIndex: 0, pageSize: 10 });
    });
});
