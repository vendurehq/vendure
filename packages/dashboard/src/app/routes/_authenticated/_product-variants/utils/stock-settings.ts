export type TrackInventorySetting = 'INHERIT' | 'TRUE' | 'FALSE';

export interface EffectiveStockSettingsInput {
    /** The variant's `trackInventory` value ("INHERIT" defers to the active Channel). */
    trackInventory: TrackInventorySetting;
    /** Whether the variant uses the global out-of-stock threshold instead of its own. */
    useGlobalOutOfStockThreshold: boolean;
    /** The variant's own stored threshold, preserved even while the global switch is on. */
    outOfStockThreshold: number | null | undefined;
    /** The active Channel's `trackInventory`; undefined until the query loads. */
    channelTrackInventory: boolean | null | undefined;
    /** The global out-of-stock threshold; undefined until the query loads. */
    globalOutOfStockThreshold: number | undefined;
}

export interface EffectiveStockSettings {
    /** The value an INHERIT variant takes from the active Channel, or undefined until loaded. */
    inheritedTrackInventory: boolean | undefined;
    /**
     * Whether inventory is tracked for this variant by default, resolving INHERIT against the
     * Channel. Individual stock levels can still override it.
     */
    effectiveTrackInventory: boolean | undefined;
    /** The threshold value to show in the input: the global value while inheriting, else the variant's own. */
    displayedThreshold: number;
    /** Whether the threshold input is disabled because the variant inherits the global value. */
    thresholdDisabled: boolean;
}

/**
 * Resolves the effective stock settings displayed on the variant detail page from the
 * variant's own flags plus the Channel and global settings. Both the track-inventory select
 * label and the out-of-stock threshold input consume this single source so they can never
 * disagree about what the inherited value actually is.
 */
export function resolveEffectiveStockSettings(input: EffectiveStockSettingsInput): EffectiveStockSettings {
    const inheritedTrackInventory = input.channelTrackInventory ?? undefined;
    const effectiveTrackInventory =
        input.trackInventory === 'INHERIT' ? inheritedTrackInventory : input.trackInventory === 'TRUE';
    return {
        inheritedTrackInventory,
        effectiveTrackInventory,
        displayedThreshold: input.useGlobalOutOfStockThreshold
            ? (input.globalOutOfStockThreshold ?? 0)
            : (input.outOfStockThreshold ?? 0),
        thresholdDisabled: input.useGlobalOutOfStockThreshold,
    };
}
