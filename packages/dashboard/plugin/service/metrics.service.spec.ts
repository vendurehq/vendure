import { CacheService, RequestContext, TransactionalConnection } from '@vendure/core';
import { startOfDay } from 'date-fns';
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
    };
    const cacheService = {
        get: vi.fn(),
        set: vi.fn(),
    };
    const ctx = {
        channelId: 1,
        channel: { token: 'default-channel' },
    } as RequestContext;

    beforeEach(() => {
        vi.clearAllMocks();
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
        cacheService.get.mockResolvedValue(undefined);
        cacheService.set.mockResolvedValue(undefined);
    });

    it('calculates all metrics from database aggregates containing more than 1000 orders', async () => {
        const date = new Date('2026-07-15T12:00:00.000Z');
        const dateKey = startOfDay(date).toISOString().split('T')[0];
        queryBuilder.getRawMany.mockResolvedValue([
            {
                date: dateKey,
                orderCount: '1501',
                orderTotal: '3002000',
                averageOrderValue: '2000',
            },
        ]);
        const service = new MetricsService(
            connection as unknown as TransactionalConnection,
            cacheService as unknown as CacheService,
        );

        const result = await service.getMetrics(ctx, {
            startDate: date.toISOString(),
            endDate: date.toISOString(),
            refresh: true,
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
        expect(queryBuilder.select).toHaveBeenCalledWith('DATE(order.orderPlacedAt)', 'date');
        expect(queryBuilder.addSelect).toHaveBeenCalledWith(
            'COALESCE(ROUND(AVG(order.subTotalWithTax + order.shippingWithTax)), 0)',
            'averageOrderValue',
        );
        expect(queryBuilder.groupBy).toHaveBeenCalledWith('DATE(order.orderPlacedAt)');
        expect(queryBuilder.getRawMany).toHaveBeenCalledOnce();
    });

    it('fills days without orders with zero values', async () => {
        queryBuilder.getRawMany.mockResolvedValue([]);
        const service = new MetricsService(
            connection as unknown as TransactionalConnection,
            cacheService as unknown as CacheService,
        );

        const result = await service.getMetrics(ctx, {
            startDate: '2026-07-15T12:00:00.000Z',
            endDate: '2026-07-15T12:00:00.000Z',
            refresh: true,
            types: [DashboardMetricType.OrderCount, DashboardMetricType.OrderTotal],
        });

        expect(result.map(metric => metric.entries[0].value)).toEqual([0, 0]);
    });
});
