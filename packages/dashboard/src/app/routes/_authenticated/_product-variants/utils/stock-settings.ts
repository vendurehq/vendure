export type TrackInventorySetting = 'INHERIT' | 'TRUE' | 'FALSE';

export interface GlobalStockSettings {
    trackInventory: boolean;
    outOfStockThreshold: number;
}

export interface EffectiveStockSettingsInput {
    /** The variant's `trackInventory` value ("INHERIT" defers to global settings). */
    trackInventory: TrackInventorySetting;
    /** Whether the variant uses the global out-of-stock threshold instead of its own. */
    useGlobalOutOfStockThreshold: boolean;
    /** The variant's own stored threshold, preserved even while the global switch is on. */
    outOfStockThreshold: number | null | undefined;
    /** Resolved global settings; undefined until the query loads. */
    globalSettings: GlobalStockSettings | undefined;
}

export interface EffectiveStockSettings {
    /** The resolved global "track inventory" value, or undefined until global settings load. */
    globalTrackInventory: boolean | undefined;
    /** Whether inventory is effectively tracked for this variant, resolving INHERIT against global. */
    effectiveTrackInventory: boolean | undefined;
    /** The threshold value to show in the input: the global value while inheriting, else the variant's own. */
    displayedThreshold: number;
    /** Whether the threshold input is disabled because the variant inherits the global value. */
    thresholdDisabled: boolean;
}

/**
 * Resolves the effective stock settings displayed on the variant detail page from the
 * variant's own flags plus the global settings. Both the track-inventory select label
 * and the out-of-stock threshold input consume this single source so they can never
 * disagree about what the inherited/global value actually is.
 */
export function resolveEffectiveStockSettings(input: EffectiveStockSettingsInput): EffectiveStockSettings {
    const globalTrackInventory = input.globalSettings?.trackInventory;
    const globalThreshold = input.globalSettings?.outOfStockThreshold ?? 0;
    const effectiveTrackInventory =
        input.trackInventory === 'INHERIT' ? globalTrackInventory : input.trackInventory === 'TRUE';
    return {
        globalTrackInventory,
        effectiveTrackInventory,
        displayedThreshold: input.useGlobalOutOfStockThreshold
            ? globalThreshold
            : (input.outOfStockThreshold ?? 0),
        thresholdDisabled: input.useGlobalOutOfStockThreshold,
    };
}
