import { RequestContext } from '@vendure/core';

import { MetricData } from '../service/metrics.service';
import { MetricInterval, MetricSummaryEntry, MetricType } from '../types';

/**
 * Calculate your metric data based on the given input.
 * Be careful with heavy queries and calculations,
 * as this function is executed everytime a user views its dashboard
 *
 */
export interface MetricCalculation {
    type: MetricType;

    getTitle(ctx: RequestContext): string;

    calculateEntry(ctx: RequestContext, interval: MetricInterval, data: MetricData): MetricSummaryEntry;
}

export function getMonthName(monthNr: number): string {
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return monthNames[monthNr];
}

/**
 * Calculates the average order value per month/week
 */
export class AverageOrderValueMetric implements MetricCalculation {
    readonly type = MetricType.AverageOrderValue;

    getTitle(ctx: RequestContext): string {
        return 'average-order-value';
    }

    calculateEntry(ctx: RequestContext, interval: MetricInterval, data: MetricData): MetricSummaryEntry {
        const label = data.date.toISOString();
        if (!data.orders.length) {
            return {
                label,
                value: 0,
            };
        }
        const total = data.orders.map(o => o.totalWithTax).reduce((_total, current) => _total + current);
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
    readonly type = MetricType.OrderCount;

    getTitle(ctx: RequestContext): string {
        return 'order-count';
    }

    calculateEntry(ctx: RequestContext, interval: MetricInterval, data: MetricData): MetricSummaryEntry {
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
    readonly type = MetricType.OrderTotal;

    getTitle(ctx: RequestContext): string {
        return 'order-totals';
    }

    calculateEntry(ctx: RequestContext, interval: MetricInterval, data: MetricData): MetricSummaryEntry {
        const label = data.date.toISOString();
        return {
            label,
            value: data.orders.map(o => o.totalWithTax).reduce((_total, current) => _total + current, 0),
        };
    }
}
