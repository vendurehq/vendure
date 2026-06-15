import { describe, expect, it } from 'vitest';

import { getChangedStockLevels } from './stock-levels.js';

describe('getChangedStockLevels', () => {
    const original = [
        { stockLocationId: '1', stockOnHand: 100 },
        { stockLocationId: '2', stockOnHand: 50 },
    ];

    it('returns nothing when no stock was edited', () => {
        // #4803 — editing an unrelated field (e.g. SKU) resubmits page-load stock;
        // it must not be sent back, or core would revert concurrent stock changes.
        const submitted = [
            { stockLocationId: '1', stockOnHand: 100 },
            { stockLocationId: '2', stockOnHand: 50 },
        ];
        expect(getChangedStockLevels(submitted, original)).toEqual([]);
    });

    it('returns only the location whose value changed', () => {
        const submitted = [
            { stockLocationId: '1', stockOnHand: 120 },
            { stockLocationId: '2', stockOnHand: 50 },
        ];
        expect(getChangedStockLevels(submitted, original)).toEqual([
            { stockLocationId: '1', stockOnHand: 120 },
        ]);
    });

    it('does not send an unchanged location even when another location is edited', () => {
        // The unedited location may have changed concurrently in the DB; resending its
        // stale page-load value would overwrite that concurrent change.
        const submitted = [
            { stockLocationId: '1', stockOnHand: 120 },
            { stockLocationId: '2', stockOnHand: 50 },
        ];
        expect(getChangedStockLevels(submitted, original)).not.toContainEqual({
            stockLocationId: '2',
            stockOnHand: 50,
        });
    });

    it('includes newly-added stock locations', () => {
        const submitted = [
            { stockLocationId: '1', stockOnHand: 100 },
            { stockLocationId: '2', stockOnHand: 50 },
            { stockLocationId: '3', stockOnHand: 0 },
        ];
        expect(getChangedStockLevels(submitted, original)).toEqual([
            { stockLocationId: '3', stockOnHand: 0 },
        ]);
    });

    it('treats missing original as all-new', () => {
        const submitted = [{ stockLocationId: '1', stockOnHand: 10 }];
        expect(getChangedStockLevels(submitted, undefined)).toEqual(submitted);
    });

    it('returns empty for missing submitted', () => {
        expect(getChangedStockLevels(undefined, original)).toEqual([]);
    });
});
