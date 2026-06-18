import { Injectable } from '@nestjs/common';
import { assertNever } from '@vendure/common/lib/shared-utils';
import { CacheService, Logger, Order, RequestContext, TransactionalConnection } from '@vendure/core';
import { createHash } from 'crypto';
import {
    Duration,
    endOfDay,
    getDayOfYear,
    getISOWeek,
    getMonth,
    setDayOfYear,
    startOfDay,
    sub,
} from 'date-fns';

import {
    AverageOrderValueMetric,
    MetricCalculation,
    OrderCountMetric,
    OrderTotalMetric,
} from '../config/metrics-strategies';
import { loggerCtx } from '../constants';
import { MetricInterval, MetricSummary, MetricSummaryEntry, MetricSummaryInput } from '../types';

export type MetricData = {
    date: Date;
    orders: Order[];
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
        { interval, types, refresh }: MetricSummaryInput,
    ): Promise<MetricSummary[]> {
        // Set 23:59:59.999 as endDate
        const endDate = endOfDay(new Date());
        // Check if we have cached result
        const hash = createHash('sha1')
            .update(
                JSON.stringify({
                    endDate,
                    types: types.sort(),
                    interval,
                    channel: ctx.channel.token,
                }),
            )
            .digest('base64');
        const cacheKey = `MetricsService:${hash}`;
        const cachedMetricList = await this.cacheService.get<MetricSummary[]>(cacheKey);
        if (cachedMetricList && refresh !== true) {
            Logger.verbose(`Returning cached metrics for channel ${ctx.channel.token}`, loggerCtx);
            return cachedMetricList;
        }
        // No cache, calculating new metrics
        Logger.verbose(
            `No cache hit, calculating ${interval} metrics until ${endDate.toISOString()} for channel ${
                ctx.channel.token
            } for all orders`,
            loggerCtx,
        );
        const data = await this.loadData(ctx, interval, endDate);
        const metrics: MetricSummary[] = [];
        for (const type of types) {
            const metric = this.metricCalculations.find(m => m.type === type);
            if (!metric) {
                continue;
            }
            // Calculate entry (month or week)
            const entries: MetricSummaryEntry[] = [];
            data.forEach(dataPerTick => {
                entries.push(metric.calculateEntry(ctx, interval, dataPerTick));
            });
            // Create metric with calculated entries
            metrics.push({
                interval,
                title: metric.getTitle(ctx),
                type: metric.type,
                entries,
            });
        }
        await this.cacheService.set(cacheKey, metrics, { ttl: 1000 * 60 * 60 * 24 });
        return metrics;
    }

    async loadData(
        ctx: RequestContext,
        interval: MetricInterval,
        endDate: Date,
    ): Promise<Map<number, MetricData>> {
        let nrOfEntries: number;
        let backInTimeAmount: Duration;
        const orderRepo = this.connection.getRepository(ctx, Order);
        // What function to use to get the current Tick of a date (i.e. the week or month number)
        let getTickNrFn: typeof getMonth | typeof getISOWeek;
        let maxTick: number;
        switch (interval) {
            case MetricInterval.Daily: {
                nrOfEntries = 30;
                backInTimeAmount = { days: nrOfEntries };
                getTickNrFn = getDayOfYear;
                maxTick = 365;
                break;
            }
            default:
                assertNever(interval);
        }
        const startDate = startOfDay(sub(endDate, backInTimeAmount));
        const startTick = getTickNrFn(startDate);
        // Get orders in a loop until we have all
        let skip = 0;
        const take = 1000;
        let hasMoreOrders = true;
        const orders: Order[] = [];
        while (hasMoreOrders) {
            const query = orderRepo
                .createQueryBuilder('order')
                .leftJoin('order.channels', 'orderChannel')
                .where('orderChannel.id=:channelId', { channelId: ctx.channelId })
                .andWhere('order.orderPlacedAt >= :startDate', {
                    startDate: startDate.toISOString(),
                })
                .skip(skip)
                .take(take);
            const [items, nrOfOrders] = await query.getManyAndCount();
            orders.push(...items);
            Logger.verbose(
                `Fetched orders ${skip}-${skip + take} for channel ${
                    ctx.channel.token
                } for ${interval} metrics`,
                loggerCtx,
            );
            skip += items.length;
            if (orders.length >= nrOfOrders) {
                hasMoreOrders = false;
            }
        }
        Logger.verbose(
            `Finished fetching all ${orders.length} orders for channel ${ctx.channel.token} for ${interval} metrics`,
            loggerCtx,
        );
        const dataPerInterval = new Map<number, MetricData>();
        const ticks = [];
        for (let i = 1; i <= nrOfEntries; i++) {
            if (startTick + i >= maxTick) {
                // make sure we don't go over month 12 or week 52
                ticks.push(startTick + i - maxTick);
            } else {
                ticks.push(startTick + i);
            }
        }
        ticks.forEach(tick => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            const ordersInCurrentTick = orders.filter(order => getTickNrFn(order.orderPlacedAt!) === tick);
            dataPerInterval.set(tick, {
                orders: ordersInCurrentTick,
                date: setDayOfYear(endDate, tick),
            });
        });
        return dataPerInterval;
    }
}
