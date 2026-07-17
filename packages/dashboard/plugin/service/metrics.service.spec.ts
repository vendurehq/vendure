import { RequestContext, TransactionalConnection } from '@vendure/core';
import { addDays, endOfDay, format, startOfDay } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DashboardMetricType } from '../types.js';
import { MetricsService } from './metrics.service.js';

describe('Dashboard MetricsService', () => {
    const queryBuilder = {
        select: vi.fn(),
        addSelect: vi.fn(),
        innerJoin: vi.fn(),
        where: vi.fn(),
        andWhere: vi.fn(),
        groupBy: vi.fn(),
        orderBy: vi.fn(),
        getRawMany: vi.fn(),
    };
    const repository = {
        createQueryBuilder: vi.fn(() => queryBuilder),
    };
    const connection = {
        getRepository: vi.fn(() => repository),
        rawConnection: {
            options: {
                type: 'postgres',
            },
        },
    };
    const ctx = {
        channelId: 1,
        channel: { token: 'default-channel' },
    } as RequestContext;

    beforeEach(() => {
        vi.clearAllMocks();
        connection.rawConnection.options.type = 'postgres';
        for (const method of [
            queryBuilder.select,
            queryBuilder.addSelect,
            queryBuilder.innerJoin,
            queryBuilder.where,
            queryBuilder.andWhere,
            queryBuilder.groupBy,
            queryBuilder.orderBy,
        ]) {
            method.mockReturnValue(queryBuilder);
        }
    });

    it('calculates all metrics from database aggregates containing more than 1000 orders', async () => {
        const date = new Date('2026-07-15T12:00:00.000Z');
        const dateKey = format(startOfDay(date), 'yyyy-MM-dd');
        queryBuilder.getRawMany.mockResolvedValue([
            {
                date: dateKey,
                orderCount: '1501',
                orderTotal: '3002000',
                averageOrderValue: '2000',
            },
        ]);
        const service = new MetricsService(connection as unknown as TransactionalConnection);

        const result = await service.getMetrics(ctx, {
            startDate: date.toISOString(),
            endDate: date.toISOString(),
            types: [
                DashboardMetricType.OrderCount,
                DashboardMetricType.OrderTotal,
                DashboardMetricType.AverageOrderValue,
            ],
        });

        expect(result.find(metric => metric.type === DashboardMetricType.OrderCount)?.entries[0].value).toBe(
            1501,
        );
        expect(result.find(metric => metric.type === DashboardMetricType.OrderTotal)?.entries[0].value).toBe(
            3002000,
        );
        expect(
            result.find(metric => metric.type === DashboardMetricType.AverageOrderValue)?.entries[0].value,
        ).toBe(2000);
        expect(queryBuilder.select).toHaveBeenCalledWith(
            `TO_CHAR(order.orderPlacedAt, 'YYYY-MM-DD')`,
            'date',
        );
        expect(queryBuilder.addSelect).toHaveBeenCalledWith(
            'COALESCE(ROUND(AVG(order.subTotalWithTax + order.shippingWithTax)), 0)',
            'averageOrderValue',
        );
        expect(queryBuilder.groupBy).toHaveBeenCalledWith(
            `TO_CHAR(order.orderPlacedAt, 'YYYY-MM-DD')`,
        );
        expect(queryBuilder.getRawMany).toHaveBeenCalledOnce();
    });

    it('fills gaps in multi-day results and scopes the query by channel and date range', async () => {
        const startDate = new Date('2026-07-14T12:00:00.000Z');
        const endDate = new Date('2026-07-18T12:00:00.000Z');
        const normalizedStart = startOfDay(startDate);
        const normalizedEnd = endOfDay(endDate);
        queryBuilder.getRawMany.mockResolvedValue([
            {
                date: format(normalizedStart, 'yyyy-MM-dd'),
                orderCount: '10',
                orderTotal: '20000',
                averageOrderValue: '2000',
            },
            {
                date: format(addDays(normalizedStart, 2), 'yyyy-MM-dd'),
                orderCount: '4',
                orderTotal: '12000',
                averageOrderValue: '3000',
            },
        ]);
        const service = new MetricsService(connection as unknown as TransactionalConnection);

        const result = await service.getMetrics(ctx, {
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
            types: [DashboardMetricType.OrderCount, DashboardMetricType.OrderTotal],
        });

        expect(result.find(metric => metric.type === DashboardMetricType.OrderCount)?.entries).toEqual([
            expect.objectContaining({ value: 10 }),
            expect.objectContaining({ value: 0 }),
            expect.objectContaining({ value: 4 }),
            expect.objectContaining({ value: 0 }),
            expect.objectContaining({ value: 0 }),
        ]);
        expect(queryBuilder.where).toHaveBeenCalledWith('orderChannel.id = :channelId', {
            channelId: ctx.channelId,
        });
        expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(1, 'order.orderPlacedAt >= :startDate', {
            startDate: normalizedStart.toISOString(),
        });
        expect(queryBuilder.andWhere).toHaveBeenNthCalledWith(2, 'order.orderPlacedAt <= :endDate', {
            endDate: normalizedEnd.toISOString(),
        });
    });

    it.each([
        ['postgres', `TO_CHAR(order.orderPlacedAt, 'YYYY-MM-DD')`],
        ['mysql', `DATE_FORMAT(order.orderPlacedAt, '%Y-%m-%d')`],
        ['mariadb', `DATE_FORMAT(order.orderPlacedAt, '%Y-%m-%d')`],
        ['better-sqlite3', `STRFTIME('%Y-%m-%d', order.orderPlacedAt)`],
        ['sqlite', `STRFTIME('%Y-%m-%d', order.orderPlacedAt)`],
        ['sqljs', `STRFTIME('%Y-%m-%d', order.orderPlacedAt)`],
    ])('formats dates as strings for the %s driver', async (databaseType, dateExpression) => {
        connection.rawConnection.options.type = databaseType;
        queryBuilder.getRawMany.mockResolvedValue([]);
        const service = new MetricsService(connection as unknown as TransactionalConnection);

        await service.loadData(
            ctx,
            startOfDay(new Date('2026-07-15T12:00:00.000Z')),
            endOfDay(new Date('2026-07-15T12:00:00.000Z')),
        );

        expect(queryBuilder.select).toHaveBeenCalledWith(dateExpression, 'date');
        expect(queryBuilder.groupBy).toHaveBeenCalledWith(dateExpression);
    });
});
