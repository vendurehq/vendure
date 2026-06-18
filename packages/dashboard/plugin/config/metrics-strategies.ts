import { RequestContext } from '@vendure/core';

import { MetricData } from '../service/metrics.service.js';
import { DashboardMetricSummaryEntry, DashboardMetricType } from '../types.js';

/**
 * Calculate your metric data based on the given input.
 * Be careful with heavy queries and calculations,
 * as this function is executed everytime a user views its dashboard
 *
 */
export interface MetricCalculation {
    type: DashboardMetricType;

    getTitle(ctx: RequestContext): string;

    calculateEntry(ctx: RequestContext, data: MetricData): DashboardMetricSummaryEntry;
}

export function getMonthName(monthNr: number): string {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthNames[monthNr];
}

/**
 * Calculates the average order value per month/week
 */
export class AverageOrderValueMetric implements MetricCalculation {
    readonly type = DashboardMetricType.AverageOrderValue;

    getTitle(ctx: RequestContext): string {
        return 'average-order-value';
    }

    calculateEntry(ctx: RequestContext, data: MetricData): DashboardMetricSummaryEntry {
        const label = data.date.toISOString();
        if (!data.orders.length) {
            return {
                label,
                value: 0,
            };
        }
        const total = data.orders.map(o => o.totalWithTax).reduce((_total, current) => _total + current, 0);
        const average = Math.round(total / data.orders.length);
        return {
            label,
            value: average,
        };
    }
}

/**
 * Calculates number of orders
 */
export class OrderCountMetric implements MetricCalculation {
    readonly type = DashboardMetricType.OrderCount;

    getTitle(ctx: RequestContext): string {
        return 'order-count';
    }

    calculateEntry(ctx: RequestContext, data: MetricData): DashboardMetricSummaryEntry {
        const label = data.date.toISOString();
        return {
            label,
            value: data.orders.length,
        };
    }
}

/**
 * Calculates order total
 */
export class OrderTotalMetric implements MetricCalculation {
    readonly type = DashboardMetricType.OrderTotal;

    getTitle(ctx: RequestContext): string {
        return 'order-totals';
    }

    calculateEntry(ctx: RequestContext, data: MetricData): DashboardMetricSummaryEntry {
        const label = data.date.toISOString();
        return {
            label,
            value: data.orders.map(o => o.totalWithTax).reduce((_total, current) => _total + current, 0),
        };
    }
}
