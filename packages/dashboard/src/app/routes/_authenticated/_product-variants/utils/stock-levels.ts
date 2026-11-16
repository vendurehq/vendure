import { TrackInventorySetting } from './stock-settings.js';

export interface StockLevelInput {
    stockLocationId: string;
    stockOnHand?: number | null;
    trackInventory?: TrackInventorySetting | null;
}

/**
 * Returns only the stock levels the admin actually changed relative to the values
 * loaded into the form (`original`): edited locations and newly-added locations.
 * Unchanged locations are dropped.
 *
 * Core treats a submitted `stockOnHand` as an absolute target and applies the delta
 * against the *current* DB value (it no-ops when the value already matches). So
 * resending an unchanged page-load value is harmless only while the DB value hasn't
 * drifted — if stock moved concurrently (an order completed, another admin edited,
 * an integration ran), the stale value silently reverts that movement. Mirrors the
 * legacy Angular UI, which only sent dirty stock locations. See #4803.
 *
 * For the same reason, a location whose tracking setting changed but whose stock did not is
 * sent with `trackInventory` only, without `stockOnHand` (#2908).
 */
export function getChangedStockLevels(
    submitted: readonly StockLevelInput[] | null | undefined,
    original: readonly StockLevelInput[] | null | undefined,
): StockLevelInput[] {
    if (!submitted) {
        return [];
    }
    const originalByLocation = new Map((original ?? []).map(s => [s.stockLocationId, s]));
    const changed: StockLevelInput[] = [];
    for (const level of submitted) {
        const originalLevel = originalByLocation.get(level.stockLocationId);
        if (!originalLevel) {
            // A newly added location: send everything.
            changed.push(level);
            continue;
        }
        const stockChanged = originalLevel.stockOnHand !== level.stockOnHand;
        const trackingChanged =
            (originalLevel.trackInventory ?? 'INHERIT') !== (level.trackInventory ?? 'INHERIT');
        if (!stockChanged && !trackingChanged) {
            continue;
        }
        changed.push({
            stockLocationId: level.stockLocationId,
            ...(stockChanged ? { stockOnHand: level.stockOnHand } : {}),
            ...(trackingChanged ? { trackInventory: level.trackInventory } : {}),
        });
    }
    return changed;
}
