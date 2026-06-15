export interface StockLevelInput {
    stockLocationId: string;
    stockOnHand: number;
}

/**
 * Returns only the stock levels the admin actually changed relative to the values
 * loaded into the form (`original`): edited locations and newly-added locations.
 * Unchanged locations are dropped.
 *
 * Core applies submitted stock as an absolute target relative to the *current* DB
 * value, so resending an unchanged page-load value silently reverts any stock
 * movement (orders, another admin, integrations) that happened since the page was
 * opened. Mirrors the legacy Angular UI, which only sent dirty stock locations.
 * See #4803.
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
