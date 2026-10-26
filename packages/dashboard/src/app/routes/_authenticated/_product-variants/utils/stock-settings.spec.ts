import { describe, expect, it } from 'vitest';

import { resolveEffectiveStockSettings } from './stock-settings.js';

describe('resolveEffectiveStockSettings', () => {
    const globalSettings = { trackInventory: true, outOfStockThreshold: 5 };

    it('resolves INHERIT to the global track-inventory value', () => {
        const result = resolveEffectiveStockSettings({
            trackInventory: 'INHERIT',
            useGlobalOutOfStockThreshold: false,
            outOfStockThreshold: 0,
            globalSettings,
        });
        expect(result.globalTrackInventory).toBe(true);
        expect(result.effectiveTrackInventory).toBe(true);
    });

    it('resolves INHERIT to the global value when global tracking is off', () => {
        const result = resolveEffectiveStockSettings({
            trackInventory: 'INHERIT',
            useGlobalOutOfStockThreshold: false,
            outOfStockThreshold: 0,
            globalSettings: { trackInventory: false, outOfStockThreshold: 5 },
        });
        expect(result.effectiveTrackInventory).toBe(false);
    });

    it('uses the explicit TRUE/FALSE value regardless of global settings', () => {
        expect(
            resolveEffectiveStockSettings({
                trackInventory: 'TRUE',
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: 0,
                globalSettings: { trackInventory: false, outOfStockThreshold: 5 },
            }).effectiveTrackInventory,
        ).toBe(true);
        expect(
            resolveEffectiveStockSettings({
                trackInventory: 'FALSE',
                useGlobalOutOfStockThreshold: false,
                outOfStockThreshold: 0,
                globalSettings,
            }).effectiveTrackInventory,
        ).toBe(false);
    });

    it('leaves the resolved global value undefined until global settings load', () => {
        const result = resolveEffectiveStockSettings({
            trackInventory: 'INHERIT',
            useGlobalOutOfStockThreshold: false,
            outOfStockThreshold: 3,
            globalSettings: undefined,
        });
        expect(result.globalTrackInventory).toBeUndefined();
        expect(result.effectiveTrackInventory).toBeUndefined();
    });

    it('displays the variant threshold and enables the input when not inheriting', () => {
        const result = resolveEffectiveStockSettings({
            trackInventory: 'INHERIT',
            useGlobalOutOfStockThreshold: false,
            outOfStockThreshold: 12,
            globalSettings,
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
            globalSettings,
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
                globalSettings,
            }).displayedThreshold,
        ).toBe(0);
        expect(
            resolveEffectiveStockSettings({
                trackInventory: 'INHERIT',
                useGlobalOutOfStockThreshold: true,
                outOfStockThreshold: 12,
                globalSettings: undefined,
            }).displayedThreshold,
        ).toBe(0);
    });
});
