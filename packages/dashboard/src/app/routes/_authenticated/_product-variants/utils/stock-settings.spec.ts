import { describe, expect, it } from 'vitest';

import { resolveEffectiveStockSettings } from './stock-settings.js';

describe('resolveEffectiveStockSettings', () => {
    const loaded = { channelTrackInventory: true, globalOutOfStockThreshold: 5 };

    it('resolves INHERIT to the Channel track-inventory value', () => {
        const result = resolveEffectiveStockSettings({
            trackInventory: 'INHERIT',
            useGlobalOutOfStockThreshold: false,
            outOfStockThreshold: 0,
            ...loaded,
        });
        expect(result.inheritedTrackInventory).toBe(true);
        expect(result.effectiveTrackInventory).toBe(true);
    });

    it('resolves INHERIT to the Channel value when the Channel does not track', () => {
        const result = resolveEffectiveStockSettings({
            trackInventory: 'INHERIT',
            useGlobalOutOfStockThreshold: false,
            outOfStockThreshold: 0,
            channelTrackInventory: false,
            globalOutOfStockThreshold: 5,
        });
        expect(result.effectiveTrackInventory).toBe(false);
    });

    it('uses the explicit TRUE/FALSE value regardless of the Channel', () => {
        expect(
            resolveEffectiveStockSettings({
                trackInventory: 'TRUE',
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: 0,
                channelTrackInventory: false,
                globalOutOfStockThreshold: 5,
            }).effectiveTrackInventory,
        ).toBe(true);
        expect(
            resolveEffectiveStockSettings({
                trackInventory: 'FALSE',
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: 0,
                ...loaded,
            }).effectiveTrackInventory,
        ).toBe(false);
    });

    it('leaves the inherited value undefined until the Channel loads', () => {
        const result = resolveEffectiveStockSettings({
            trackInventory: 'INHERIT',
            useGlobalOutOfStockThreshold: false,
            outOfStockThreshold: 3,
            channelTrackInventory: undefined,
            globalOutOfStockThreshold: undefined,
        });
        expect(result.inheritedTrackInventory).toBeUndefined();
        expect(result.effectiveTrackInventory).toBeUndefined();
    });

    it('displays the variant threshold and enables the input when not inheriting', () => {
        const result = resolveEffectiveStockSettings({
            trackInventory: 'INHERIT',
            useGlobalOutOfStockThreshold: false,
            outOfStockThreshold: 12,
            ...loaded,
        });
        expect(result.displayedThreshold).toBe(12);
        expect(result.thresholdDisabled).toBe(false);
    });

    it('displays the global threshold and disables the input when inheriting', () => {
        const result = resolveEffectiveStockSettings({
            trackInventory: 'INHERIT',
            useGlobalOutOfStockThreshold: true,
            // The variant's own value is preserved but not shown while inheriting.
            outOfStockThreshold: 12,
            ...loaded,
        });
        expect(result.displayedThreshold).toBe(5);
        expect(result.thresholdDisabled).toBe(true);
    });

    it('falls back to 0 for the displayed threshold when values are missing', () => {
        expect(
            resolveEffectiveStockSettings({
                trackInventory: 'INHERIT',
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: null,
                ...loaded,
            }).displayedThreshold,
        ).toBe(0);
        expect(
            resolveEffectiveStockSettings({
                trackInventory: 'INHERIT',
                useGlobalOutOfStockThreshold: true,
                outOfStockThreshold: 12,
                channelTrackInventory: undefined,
                globalOutOfStockThreshold: undefined,
            }).displayedThreshold,
        ).toBe(0);
    });
});
