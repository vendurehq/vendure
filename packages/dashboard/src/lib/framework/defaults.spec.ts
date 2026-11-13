import { describe, expect, it } from 'vitest';

import { buildInitialWidgetState } from './dashboard-widget/insights-layout.js';
import { getVisibleDashboardWidgets } from './dashboard-widget/widget-extensions.js';
import { registerDefaults } from './defaults.js';

describe('built-in Insights widgets', () => {
    // #5616: the built-in widgets tile without holes for a user with no saved layout
    it('lays out the registered built-in widgets without holes for a fresh user', () => {
        registerDefaults();

        const state = buildInitialWidgetState({}, getVisibleDashboardWidgets());
        const byId = Object.fromEntries(state.visible.map(w => [w.widgetId, w.layout]));
        const covered = new Set<string>();
        for (const l of state.visible.map(w => w.layout)) {
            for (let y = l.y; y < l.y + l.h; y++) {
                for (let x = l.x; x < l.x + l.w; x++) {
                    covered.add(`${x},${y}`);
                }
            }
        }
        const bottom = Math.max(...state.visible.map(w => w.layout.y + w.layout.h));
        const holeRows = new Set<number>();
        for (let y = 0; y < bottom; y++) {
            for (let x = 0; x < 12; x++) {
                if (!covered.has(`${x},${y}`)) {
                    holeRows.add(y);
                }
            }
        }
        const lastRow = [
            byId['top-products-widget'],
            byId['low-stock-widget'],
            byId['latest-customers-widget'],
        ];

        // Top Products, Low Stock and Latest Customers share one row across the full width.
        expect(lastRow.map(l => l.x)).toEqual([0, 4, 8]);
        expect(new Set(lastRow.map(l => l.y)).size).toBe(1);
        // Only the slot left by Latest Orders (h7) beside Orders Summary (h3) may stay empty.
        const ordersSummary = byId['orders-summary-widget'];
        const latestOrders = byId['latest-orders-widget'];
        for (const y of holeRows) {
            expect(y).toBeGreaterThanOrEqual(ordersSummary.y + ordersSummary.h);
            expect(y).toBeLessThan(latestOrders.y + latestOrders.h);
        }
    });
});
