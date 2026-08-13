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

    it('sends only the edited location across many, leaving the others untouched', () => {
        // Each unedited location may have changed concurrently in the DB; resending its
        // stale page-load value would overwrite that concurrent change.
        const threeLocations = [
            { stockLocationId: '1', stockOnHand: 100 },
            { stockLocationId: '2', stockOnHand: 50 },
            { stockLocationId: '3', stockOnHand: 25 },
        ];
        const submitted = [
            { stockLocationId: '1', stockOnHand: 100 },
            { stockLocationId: '2', stockOnHand: 70 },
            { stockLocationId: '3', stockOnHand: 25 },
        ];
        expect(getChangedStockLevels(submitted, threeLocations)).toEqual([
            { stockLocationId: '2', stockOnHand: 70 },
        ]);
    });

    it('does not include a location edited then reverted to its original value', () => {
        // Guards against switching to a dirty-flag approach: a field edited and changed
        // back is still "dirty" in react-hook-form, but its value is unchanged, so it
        // must not be resent.
        const submitted = [
            { stockLocationId: '1', stockOnHand: 100 }, // 100 -> 120 -> 100
            { stockLocationId: '2', stockOnHand: 50 },
        ];
        expect(getChangedStockLevels(submitted, original)).toEqual([]);
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

    it('returns empty for an empty submitted array', () => {
        expect(getChangedStockLevels([], original)).toEqual([]);
    });

    it('returns empty for null or undefined submitted', () => {
        expect(getChangedStockLevels(null, original)).toEqual([]);
        expect(getChangedStockLevels(undefined, original)).toEqual([]);
    });
});
