import { Injectable } from '@nestjs/common';
import { CacheService, Logger, Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { endOfDay, startOfDay } from 'date-fns';
import { createHash } from 'node:crypto';

import {
    AverageOrderValueMetric,
    MetricCalculation,
    OrderCountMetric,
    OrderTotalMetric,
} from '../config/metrics-strategies.js';
import { loggerCtx } from '../constants.js';
import {
    DashboardMetricSummary,
    DashboardMetricSummaryEntry,
    DashboardMetricSummaryInput,
} from '../types.js';

export type MetricData = {
    date: Date;
    orderCount: number;
    orderTotal: number;
    averageOrderValue: number;
};

type RawMetricData = {
    date: string;
    orderCount: string | number;
    orderTotal: string | number;
    averageOrderValue: string | number;
};

@Injectable()
export class MetricsService {
    metricCalculations: MetricCalculation[];

    constructor(
        private connection: TransactionalConnection,
        private cacheService: CacheService,
    ) {
        this.metricCalculations = [
            new AverageOrderValueMetric(),
            new OrderCountMetric(),
            new OrderTotalMetric(),
        ];
    }

    async getMetrics(
        ctx: RequestContext,
        { types, refresh, startDate, endDate }: DashboardMetricSummaryInput,
    ): Promise<DashboardMetricSummary[]> {
        const calculatedStartDate = startOfDay(new Date(startDate));
        const calculatedEndDate = endOfDay(new Date(endDate));
        // Check if we have cached result
        const hash = createHash('sha1')
            .update(
                JSON.stringify({
                    startDate: calculatedStartDate,
                    endDate: calculatedEndDate,
                    types: [...types].sort((a, b) => a.localeCompare(b)),
                    channel: ctx.channel.token,
                }),
            )
            .digest('base64');
        const cacheKey = `MetricsService:${hash}`;
        const cachedMetricList = await this.cacheService.get<DashboardMetricSummary[]>(cacheKey);
        if (cachedMetricList && refresh !== true) {
            Logger.verbose(`Returning cached metrics for channel ${ctx.channel.token}`, loggerCtx);
            return cachedMetricList;
        }
        // No cache, calculating new metrics
        Logger.verbose(
            `No cache hit, calculating metrics from ${calculatedStartDate.toISOString()} to ${calculatedEndDate.toISOString()} for channel ${
                ctx.channel.token
            } for all orders`,
            loggerCtx,
        );
        const data = await this.loadData(ctx, calculatedStartDate, calculatedEndDate);
        const metrics: DashboardMetricSummary[] = [];
        for (const type of types) {
            const metric = this.metricCalculations.find(m => m.type === type);
            if (!metric) {
                continue;
            }
            // Calculate entries for each day
            const entries: DashboardMetricSummaryEntry[] = [];
            data.forEach(dataPerDay => {
                entries.push(metric.calculateEntry(ctx, dataPerDay));
            });
            // Create metric with calculated entries
            metrics.push({
                title: metric.getTitle(ctx),
                type: metric.type,
                entries,
            });
        }
        await this.cacheService.set(cacheKey, metrics, { ttl: 1000 * 60 * 60 * 2 }); // 2 hours
        return metrics;
    }

    async loadData(ctx: RequestContext, startDate: Date, endDate: Date): Promise<Map<string, MetricData>> {
        const orderRepo = this.connection.getRepository(ctx, Order);

        // Calculate number of days between start and end
        const diffTime = Math.abs(endDate.getTime() - startDate.getTime());
        const nrOfDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;

        const dateExpression = 'DATE(order.orderPlacedAt)';
        const rows: RawMetricData[] = await orderRepo
            .createQueryBuilder('order')
            .select(dateExpression, 'date')
            .addSelect('COUNT(order.id)', 'orderCount')
            .addSelect('COALESCE(SUM(order.subTotalWithTax + order.shippingWithTax), 0)', 'orderTotal')
            .addSelect(
                'COALESCE(ROUND(AVG(order.subTotalWithTax + order.shippingWithTax)), 0)',
                'averageOrderValue',
            )
            .innerJoin('order.channels', 'orderChannel')
            .where('orderChannel.id = :channelId', { channelId: ctx.channelId })
            .andWhere('order.orderPlacedAt >= :startDate', { startDate: startDate.toISOString() })
            .andWhere('order.orderPlacedAt <= :endDate', { endDate: endDate.toISOString() })
            .groupBy(dateExpression)
            .orderBy(dateExpression, 'ASC')
            .getRawMany();

        Logger.verbose(
            `Finished aggregating order metrics for channel ${ctx.channel.token} for ${rows.length} days`,
            loggerCtx,
        );

        const dataPerDay = new Map<string, MetricData>();
        const metricsByDate = new Map(
            rows.map(row => [
                row.date,
                {
                    orderCount: Number(row.orderCount),
                    orderTotal: Number(row.orderTotal),
                    averageOrderValue: Number(row.averageOrderValue),
                },
            ]),
        );

        // Create a map entry for each day in the range
        for (let i = 0; i < nrOfDays; i++) {
            const currentDate = new Date(startDate);
            currentDate.setDate(startDate.getDate() + i);
            const dateKey = currentDate.toISOString().split('T')[0]; // YYYY-MM-DD format

            const data = metricsByDate.get(dateKey);

            dataPerDay.set(dateKey, {
                date: currentDate,
                orderCount: data?.orderCount ?? 0,
                orderTotal: data?.orderTotal ?? 0,
                averageOrderValue: data?.averageOrderValue ?? 0,
            });
        }

        return dataPerDay;
    }
}
