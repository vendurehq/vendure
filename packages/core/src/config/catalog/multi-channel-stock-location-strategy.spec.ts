import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureConfigLoaded } from '../config-helpers';

/**
 * Tests for partitionKey support in MultiChannelStockLocationStrategy.
 *
 * Validates that forAllocation correctly iterates over multiple StockLevel
 * partitions at the same location, rather than picking only the first one.
 */
describe('MultiChannelStockLocationStrategy - partitionKey allocation', () => {
    let strategy: import('./multi-channel-stock-location-strategy').MultiChannelStockLocationStrategy;

    const ctx = { channelId: '1' } as any;
    const orderLine = { productVariantId: '42' } as any;
    const stockLocation = { id: '1', channels: [{ id: '1' }] } as any;

    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    beforeEach(async () => {
        const { MultiChannelStockLocationStrategy } =
            await import('./multi-channel-stock-location-strategy.js');
        strategy = new MultiChannelStockLocationStrategy();

        // Mock connection.getEntityOrThrow for variant loading
        (strategy as any).connection = {
            getEntityOrThrow: vi.fn().mockResolvedValue({
                id: '42',
                trackInventory: 'INHERIT',
                useGlobalOutOfStockThreshold: true,
                outOfStockThreshold: 0,
            }),
        };

        // Mock globalSettingsService
        (strategy as any).globalSettingsService = {
            getSettings: vi.fn().mockResolvedValue({
                trackInventory: true,
                outOfStockThreshold: 0,
            }),
        };

        // Mock requestContextCache (returns stockLevels directly)
        (strategy as any).requestContextCache = {
            get: vi.fn((_ctx: any, _key: string, fn: () => any) => fn()),
        };

        // Mock channelIdCache for stockLevelAppliesToActiveChannel
        (strategy as any).channelIdCache = {
            get: vi.fn().mockResolvedValue(['1']),
        };
    });

    it('allocates from multiple partitions at the same location', async () => {
        const stockLevels = [
            { id: '1', stockLocationId: '1', stockOnHand: 30, stockAllocated: 0, partitionKey: 'BATCH-001' },
            { id: '2', stockLocationId: '1', stockOnHand: 50, stockAllocated: 0, partitionKey: 'BATCH-002' },
        ];

        (strategy as any).requestContextCache = {
            get: vi.fn().mockResolvedValue(stockLevels),
        };

        const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 60);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            location: stockLocation,
            quantity: 30,
            partitionKey: 'BATCH-001',
        });
        expect(result[1]).toEqual({
            location: stockLocation,
            quantity: 30,
            partitionKey: 'BATCH-002',
        });
    });

    it('allocates only what is needed when first partition has enough', async () => {
        const stockLevels = [
            { id: '1', stockLocationId: '1', stockOnHand: 100, stockAllocated: 0, partitionKey: 'BATCH-001' },
            { id: '2', stockLocationId: '1', stockOnHand: 50, stockAllocated: 0, partitionKey: 'BATCH-002' },
        ];

        (strategy as any).requestContextCache = {
            get: vi.fn().mockResolvedValue(stockLevels),
        };

        const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 40);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            location: stockLocation,
            quantity: 40,
            partitionKey: 'BATCH-001',
        });
    });

    it('skips partitions with no available stock', async () => {
        const stockLevels = [
            { id: '1', stockLocationId: '1', stockOnHand: 10, stockAllocated: 10, partitionKey: 'BATCH-001' },
            { id: '2', stockLocationId: '1', stockOnHand: 50, stockAllocated: 0, partitionKey: 'BATCH-002' },
        ];

        (strategy as any).requestContextCache = {
            get: vi.fn().mockResolvedValue(stockLevels),
        };

        const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 20);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            location: stockLocation,
            quantity: 20,
            partitionKey: 'BATCH-002',
        });
    });

    it('works with single default partition (backward compatibility)', async () => {
        const stockLevels = [
            { id: '1', stockLocationId: '1', stockOnHand: 100, stockAllocated: 0, partitionKey: '' },
        ];

        (strategy as any).requestContextCache = {
            get: vi.fn().mockResolvedValue(stockLevels),
        };

        const result = await strategy.forAllocation(ctx, [stockLocation], orderLine, 5);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            location: stockLocation,
            quantity: 5,
            partitionKey: '',
        });
    });
});
