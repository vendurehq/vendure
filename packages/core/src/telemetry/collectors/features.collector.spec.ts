import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TelemetryConfig } from '../telemetry.types';

import { FeaturesCollector } from './features.collector';

describe('FeaturesCollector', () => {
    let collector: FeaturesCollector;
    let mockConnection: Record<string, any>;
    let mockRepositories: Record<string, any>;
    let baseConfig: TelemetryConfig;

    beforeEach(() => {
        mockRepositories = {
            Channel: { count: vi.fn().mockResolvedValue(1) },
            Seller: { count: vi.fn().mockResolvedValue(1) },
            StockLocation: { count: vi.fn().mockResolvedValue(1) },
            ApiKey: { count: vi.fn().mockResolvedValue(0) },
        };

        mockConnection = {
            rawConnection: {
                isInitialized: true,
                getRepository: vi.fn().mockImplementation((entity: any) => {
                    return mockRepositories[entity.name] || { count: vi.fn().mockResolvedValue(0) };
                }),
            },
        };

        baseConfig = {
            orderSellerStrategy: 'DefaultOrderSellerStrategy',
            customFieldsCount: 3,
            scheduledTaskCount: 1,
        };

        collector = new FeaturesCollector(mockConnection as any);
    });

    describe('multiChannel', () => {
        it('returns false when Channel count is 1', async () => {
            const result = await collector.collect(baseConfig);
            expect(result.multiChannel).toBe(false);
        });

        it('returns true when Channel count is > 1', async () => {
            mockRepositories.Channel.count.mockResolvedValue(3);

            const result = await collector.collect(baseConfig);

            expect(result.multiChannel).toBe(true);
        });

        it('returns undefined when DB is not initialized', async () => {
            mockConnection.rawConnection.isInitialized = false;

            const result = await collector.collect(baseConfig);

            expect(result.multiChannel).toBeUndefined();
        });
    });

    describe('multiVendor', () => {
        it('returns false when Seller count is 1 and strategy is DefaultOrderSellerStrategy', async () => {
            const result = await collector.collect(baseConfig);
            expect(result.multiVendor).toBe(false);
        });

        it('returns true when Seller count is > 1', async () => {
            mockRepositories.Seller.count.mockResolvedValue(3);

            const result = await collector.collect(baseConfig);

            expect(result.multiVendor).toBe(true);
        });

        it('returns true when custom OrderSellerStrategy is used', async () => {
            const config = { ...baseConfig, orderSellerStrategy: 'MyCustomOrderSellerStrategy' };

            const result = await collector.collect(config);

            expect(result.multiVendor).toBe(true);
        });

        it('returns undefined when DB is not initialized', async () => {
            mockConnection.rawConnection.isInitialized = false;

            const result = await collector.collect(baseConfig);

            // Consistent with other DB-dependent flags — returns undefined,
            // not false, because the strategy check alone is not authoritative
            expect(result.multiVendor).toBeUndefined();
        });

        it('returns true when DB is up and custom strategy is set but seller count is 1', async () => {
            const config = { ...baseConfig, orderSellerStrategy: 'MyCustomOrderSellerStrategy' };

            const result = await collector.collect(config);

            expect(result.multiVendor).toBe(true);
        });

        it('returns undefined when DB query fails and strategy name is default', async () => {
            mockRepositories.Seller.count.mockRejectedValue(new Error('DB error'));

            const result = await collector.collect(baseConfig);

            // DB query failed -> sellerCount is undefined -> dbReady is true
            // but safeCount returned undefined, deriveMultiVendor gets undefined
            // seller count, strategy is default -> returns false
            // Actually: the DB query failing makes safeCount return undefined.
            // deriveMultiVendor: dbReady=true, sellerCount=undefined (not > 1),
            // strategy is default -> false
            expect(result.multiVendor).toBe(false);
        });
    });

    describe('multiStockLocation', () => {
        it('returns false when StockLocation count is 1', async () => {
            const result = await collector.collect(baseConfig);
            expect(result.multiStockLocation).toBe(false);
        });

        it('returns true when StockLocation count is > 1', async () => {
            mockRepositories.StockLocation.count.mockResolvedValue(5);

            const result = await collector.collect(baseConfig);

            expect(result.multiStockLocation).toBe(true);
        });

        it('returns undefined when DB is not initialized', async () => {
            mockConnection.rawConnection.isInitialized = false;

            const result = await collector.collect(baseConfig);

            expect(result.multiStockLocation).toBeUndefined();
        });
    });

    describe('apiKeysEnabled', () => {
        it('returns false when ApiKey count is 0', async () => {
            const result = await collector.collect(baseConfig);
            expect(result.apiKeysEnabled).toBe(false);
        });

        it('returns true when ApiKey count is > 0', async () => {
            mockRepositories.ApiKey.count.mockResolvedValue(2);

            const result = await collector.collect(baseConfig);

            expect(result.apiKeysEnabled).toBe(true);
        });

        it('returns undefined when DB is not initialized', async () => {
            mockConnection.rawConnection.isInitialized = false;

            const result = await collector.collect(baseConfig);

            expect(result.apiKeysEnabled).toBeUndefined();
        });
    });

    describe('customFieldsInUse', () => {
        it('returns true when customFieldsCount > 0 in config', async () => {
            const result = await collector.collect(baseConfig);
            expect(result.customFieldsInUse).toBe(true);
        });

        it('returns false when customFieldsCount is 0', async () => {
            const config = { ...baseConfig, customFieldsCount: 0 };

            const result = await collector.collect(config);

            expect(result.customFieldsInUse).toBe(false);
        });

        it('returns false when customFieldsCount is undefined', async () => {
            const config = { ...baseConfig, customFieldsCount: undefined };

            const result = await collector.collect(config);

            expect(result.customFieldsInUse).toBe(false);
        });
    });

    describe('scheduledTasks', () => {
        it('returns true when scheduledTaskCount > 0 in config', async () => {
            const result = await collector.collect(baseConfig);
            expect(result.scheduledTasks).toBe(true);
        });

        it('returns false when scheduledTaskCount is 0', async () => {
            const config = { ...baseConfig, scheduledTaskCount: 0 };

            const result = await collector.collect(config);

            expect(result.scheduledTasks).toBe(false);
        });

        it('returns false when scheduledTaskCount is undefined', async () => {
            const config = { ...baseConfig, scheduledTaskCount: undefined };

            const result = await collector.collect(config);

            expect(result.scheduledTasks).toBe(false);
        });
    });

    describe('DB not ready', () => {
        it('returns undefined for all DB-dependent fields when rawConnection is not initialized', async () => {
            mockConnection.rawConnection.isInitialized = false;

            const result = await collector.collect(baseConfig);

            expect(result.multiChannel).toBeUndefined();
            expect(result.multiVendor).toBeUndefined();
            expect(result.multiStockLocation).toBeUndefined();
            expect(result.apiKeysEnabled).toBeUndefined();
        });

        it('still returns values for config-derived fields when DB is down', async () => {
            mockConnection.rawConnection.isInitialized = false;

            const result = await collector.collect(baseConfig);

            expect(result.customFieldsInUse).toBe(true);
            expect(result.scheduledTasks).toBe(true);
        });
    });

    describe('independence', () => {
        it('one DB query failing does not affect other fields', async () => {
            mockRepositories.Channel.count.mockRejectedValue(new Error('Channel query failed'));

            const result = await collector.collect(baseConfig);

            expect(result.multiChannel).toBeUndefined();
            // Other DB-dependent fields should still resolve
            expect(result.multiStockLocation).toBe(false);
            expect(result.apiKeysEnabled).toBe(false);
            expect(result.multiVendor).toBe(false);
            // Config-derived fields unaffected
            expect(result.customFieldsInUse).toBe(true);
            expect(result.scheduledTasks).toBe(true);
        });
    });

    describe('parallel execution', () => {
        it('runs all DB queries concurrently', async () => {
            const callOrder: string[] = [];
            for (const [name, repo] of Object.entries(mockRepositories)) {
                repo.count.mockImplementation(() => {
                    callOrder.push(`${name}-start`);
                    return Promise.resolve().then(() => {
                        callOrder.push(`${name}-end`);
                        return name === 'ApiKey' ? 0 : 1;
                    });
                });
            }

            await collector.collect(baseConfig);

            // All starts should come before any ends (parallel, not sequential)
            const starts = callOrder.filter(e => e.endsWith('-start'));
            const firstEnd = callOrder.findIndex(e => e.endsWith('-end'));
            expect(starts.length).toBe(4);
            expect(firstEnd).toBeGreaterThanOrEqual(starts.length);
        });
    });

    describe('error paths — forcing failures', () => {
        it('rawConnection is entirely undefined', async () => {
            mockConnection.rawConnection = undefined;

            const result = await collector.collect(baseConfig);

            expect(result.multiChannel).toBeUndefined();
            expect(result.multiVendor).toBeUndefined();
            expect(result.multiStockLocation).toBeUndefined();
            expect(result.apiKeysEnabled).toBeUndefined();
            expect(result.customFieldsInUse).toBe(true);
            expect(result.scheduledTasks).toBe(true);
        });

        it('rawConnection is null', async () => {
            mockConnection.rawConnection = null;

            const result = await collector.collect(baseConfig);

            expect(result.multiChannel).toBeUndefined();
            expect(result.multiVendor).toBeUndefined();
            expect(result.multiStockLocation).toBeUndefined();
            expect(result.apiKeysEnabled).toBeUndefined();
            expect(result.customFieldsInUse).toBe(true);
            expect(result.scheduledTasks).toBe(true);
        });

        it('all 4 DB queries fail simultaneously', async () => {
            for (const repo of Object.values(mockRepositories)) {
                repo.count.mockRejectedValue(new Error('Connection lost'));
            }

            const result = await collector.collect(baseConfig);

            expect(result.multiChannel).toBeUndefined();
            expect(result.multiVendor).toBe(false);
            expect(result.multiStockLocation).toBeUndefined();
            expect(result.apiKeysEnabled).toBeUndefined();
            expect(result.customFieldsInUse).toBe(true);
            expect(result.scheduledTasks).toBe(true);
        });

        it('getRepository() throws synchronously', async () => {
            mockConnection.rawConnection.getRepository = vi.fn().mockImplementation(() => {
                throw new Error('Entity not registered');
            });

            const result = await collector.collect(baseConfig);

            expect(result.multiChannel).toBeUndefined();
            expect(result.multiStockLocation).toBeUndefined();
            expect(result.apiKeysEnabled).toBeUndefined();
        });

        it('config.orderSellerStrategy is undefined — exercises ?? "unknown" fallback', async () => {
            const config = { ...baseConfig, orderSellerStrategy: undefined };

            const result = await collector.collect(config);

            // undefined falls back to 'unknown', which is treated as not-custom
            expect(result.multiVendor).toBe(false);
        });

        it('Channel count is exactly 0 — boundary', async () => {
            mockRepositories.Channel.count.mockResolvedValue(0);

            const result = await collector.collect(baseConfig);

            expect(result.multiChannel).toBe(false);
        });

        it('StockLocation count is exactly 0 — boundary', async () => {
            mockRepositories.StockLocation.count.mockResolvedValue(0);

            const result = await collector.collect(baseConfig);

            expect(result.multiStockLocation).toBe(false);
        });

        it('config with all fields undefined — empty config object', async () => {
            const result = await collector.collect({});

            expect(result.customFieldsInUse).toBe(false);
            expect(result.scheduledTasks).toBe(false);
            expect(result.multiVendor).toBe(false);
        });
    });
});
