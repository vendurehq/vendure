export interface StockLevelInput {
    stockLocationId: string;
    stockOnHand: number;
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
 */
export function getChangedStockLevels<T extends StockLevelInput>(
    submitted: readonly T[] | null | undefined,
    original: readonly StockLevelInput[] | null | undefined,
): T[] {
    if (!submitted) {
        return [];
    }
    const originalByLocation = new Map((original ?? []).map(s => [s.stockLocationId, s.stockOnHand]));
    return submitted.filter(level => {
        const originalStockOnHand = originalByLocation.get(level.stockLocationId);
        // Include new locations and locations whose value the admin edited.
        return originalStockOnHand === undefined || originalStockOnHand !== level.stockOnHand;
    });
}
