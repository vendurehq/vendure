import { GlobalFlag } from '@vendure/common/lib/generated-types';

/**
 * @description
 * The inputs needed to work out whether inventory is tracked for a ProductVariant, optionally at
 * a specific StockLocation.
 *
 * @docsCategory products & stock
 * @since 4.0.0
 */
export interface TrackInventoryInputs {
    /** `StockLevel.trackInventory`, when resolving for a specific StockLocation. */
    stockLevel?: GlobalFlag | null;
    /** `ProductVariant.trackInventory`. */
    variant: GlobalFlag;
    /** `Channel.trackInventory` of the Channel the request (or Order) belongs to. */
    channel: boolean;
}

/**
 * @description
 * Resolves whether inventory is tracked. The most specific explicit setting wins:
 *
 * 1. `StockLevel.trackInventory` (per ProductVariant per StockLocation), unless `INHERIT`
 * 2. `ProductVariant.trackInventory`, unless `INHERIT`
 * 3. `Channel.trackInventory`
 *
 * `GlobalSettings.trackInventory` is no longer consulted from v4.0. Its value is copied to
 * every Channel by the v4 migration.
 *
 * @docsCategory products & stock
 * @since 4.0.0
 */
export function resolveTrackInventory(inputs: TrackInventoryInputs): boolean {
    if (inputs.stockLevel === GlobalFlag.TRUE) {
        return true;
    }
    if (inputs.stockLevel === GlobalFlag.FALSE) {
        return false;
    }
    if (inputs.variant === GlobalFlag.TRUE) {
        return true;
    }
    if (inputs.variant === GlobalFlag.FALSE) {
        return false;
    }
    return inputs.channel;
}
