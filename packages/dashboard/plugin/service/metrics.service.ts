import { Injectable } from '@nestjs/common';
import { Logger, Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { addDays, differenceInCalendarDays, endOfDay, format, startOfDay } from 'date-fns';

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

    constructor(private connection: TransactionalConnection) {
        this.metricCalculations = [
            new AverageOrderValueMetric(),
            new OrderCountMetric(),
            new OrderTotalMetric(),
        ];
    }

    async getMetrics(
        ctx: RequestContext,
        { types, startDate, endDate }: DashboardMetricSummaryInput,
    ): Promise<DashboardMetricSummary[]> {
        const calculatedStartDate = startOfDay(new Date(startDate));
        const calculatedEndDate = endOfDay(new Date(endDate));
        Logger.verbose(
            `Calculating metrics from ${calculatedStartDate.toISOString()} to ${calculatedEndDate.toISOString()} for channel ${
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
        return metrics;
    }

    async loadData(ctx: RequestContext, startDate: Date, endDate: Date): Promise<Map<string, MetricData>> {
        const orderRepo = this.connection.getRepository(ctx, Order);

        const nrOfDays = differenceInCalendarDays(endDate, startDate) + 1;

        const dateExpression = this.getDateExpression();
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
            const currentDate = addDays(startDate, i);
            const dateKey = format(currentDate, 'yyyy-MM-dd');

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

    private getDateExpression(): string {
        switch (this.connection.rawConnection.options.type) {
            case 'postgres':
                return `TO_CHAR(order.orderPlacedAt, 'YYYY-MM-DD')`;
            case 'mysql':
            case 'mariadb':
                return `DATE_FORMAT(order.orderPlacedAt, '%Y-%m-%d')`;
            case 'better-sqlite3':
            case 'sqlite':
            case 'sqljs':
                return `STRFTIME('%Y-%m-%d', order.orderPlacedAt)`;
            default:
                return 'DATE(order.orderPlacedAt)';
        }
    }
}
