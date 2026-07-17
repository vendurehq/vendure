import { CurrencyCode, LanguageCode, OrderType } from '@vendure/common/lib/generated-types';
import {
    ChannelService,
    mergeConfig,
    Order,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { createTestEnvironment } from '@vendure/testing';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TEST_SETUP_TIMEOUT_MS, testConfig } from '../../../../e2e-common/test-config.js';
import { DashboardPlugin } from '../dashboard.plugin.js';
import { DashboardMetricType } from '../types.js';
import { MetricsService } from './metrics.service.js';

describe('Dashboard order metrics', () => {
    const { server } = createTestEnvironment(
        mergeConfig(testConfig(), {
            plugins: [DashboardPlugin],
        }),
    );
    let ctx: RequestContext;
    let metricsService: MetricsService;

    beforeAll(async () => {
        await server.init({
            initialData: {
                defaultLanguage: LanguageCode.en,
                defaultZone: 'Europe/London',
                countries: [],
                taxRates: [],
                paymentMethods: [],
                shippingMethods: [],
                collections: [],
            },
        });
        const channel = await server.app.get(ChannelService).getDefaultChannel();
        ctx = new RequestContext({
            apiType: 'admin',
            authorizedAsOwnerOnly: false,
            channel,
            isAuthorized: true,
        });
        metricsService = server.app.get(MetricsService);

        await server.app
            .get(TransactionalConnection)
            .rawConnection.getRepository(Order)
            .save([
                createOrder('metrics-1', channel, new Date(2026, 6, 15, 12), 1000, 200),
                createOrder('metrics-2', channel, new Date(2026, 6, 15, 14), 3000, 0),
                createOrder('metrics-3', channel, new Date(2026, 6, 16, 12), 500, 100),
            ]);
    }, TEST_SETUP_TIMEOUT_MS);

    afterAll(async () => {
        await server.destroy();
    });

    // #3648 — order metrics must aggregate every order and preserve calendar days across DB drivers
    it('returns database aggregates keyed to the correct calendar days', async () => {
        const result = await metricsService.getMetrics(ctx, {
            startDate: new Date(2026, 6, 14, 12).toISOString(),
            endDate: new Date(2026, 6, 16, 12).toISOString(),
            types: [
                DashboardMetricType.OrderCount,
                DashboardMetricType.OrderTotal,
                DashboardMetricType.AverageOrderValue,
            ],
        });

        expect(result.find(metric => metric.type === DashboardMetricType.OrderCount)?.entries).toEqual([
            expect.objectContaining({ value: 0 }),
            expect.objectContaining({ value: 2 }),
            expect.objectContaining({ value: 1 }),
        ]);
        expect(result.find(metric => metric.type === DashboardMetricType.OrderTotal)?.entries).toEqual([
            expect.objectContaining({ value: 0 }),
            expect.objectContaining({ value: 4200 }),
            expect.objectContaining({ value: 600 }),
        ]);
        expect(
            result.find(metric => metric.type === DashboardMetricType.AverageOrderValue)?.entries,
        ).toEqual([
            expect.objectContaining({ value: 0 }),
            expect.objectContaining({ value: 2100 }),
            expect.objectContaining({ value: 600 }),
        ]);
    });
});

function createOrder(
    code: string,
    channel: Awaited<ReturnType<ChannelService['getDefaultChannel']>>,
    orderPlacedAt: Date,
    subTotalWithTax: number,
    shippingWithTax: number,
): Order {
    return new Order({
        active: false,
        billingAddress: {},
        channels: [channel],
        code,
        couponCodes: [],
        currencyCode: CurrencyCode.USD,
        customFields: {},
        orderPlacedAt,
        shipping: shippingWithTax,
        shippingAddress: {},
        shippingWithTax,
        state: 'PaymentSettled',
        subTotal: subTotalWithTax,
        subTotalWithTax,
        type: OrderType.Regular,
    });
}
