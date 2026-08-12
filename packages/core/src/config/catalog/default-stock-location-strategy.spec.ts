import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { ensureConfigLoaded } from '../config-helpers';

/**
 * Tests for partitionKey propagation in BaseStockLocationStrategy.
 *
 * Validates that forSale/forRelease/forCancellation correctly return
 * the partitionKey from saved allocations, ensuring that stock is
 * deducted from the correct partition during the order lifecycle.
 */
describe('BaseStockLocationStrategy - partitionKey in sale/release/cancellation', () => {
    let strategy: import('./default-stock-location-strategy').DefaultStockLocationStrategy;

    const ctx = {} as any;
    const orderLine = { id: 'order-line-1', productVariantId: '42' } as any;
    const locationA = { id: '1' } as any;
    const locationB = { id: '2' } as any;

    beforeAll(async () => {
        await ensureConfigLoaded();
    });

    beforeEach(async () => {
        const { DefaultStockLocationStrategy } = await import('./default-stock-location-strategy.js');
        strategy = new DefaultStockLocationStrategy();
    });

    it('forSale returns correct partitionKey from allocations', async () => {
        // Two allocations from different partitions at the same location
        (strategy as any).connection = {
            getRepository: vi.fn().mockReturnValue({
                find: vi.fn().mockResolvedValue([
                    { stockLocationId: '1', quantity: 20, partitionKey: 'BATCH-001' },
                    { stockLocationId: '1', quantity: 10, partitionKey: 'BATCH-002' },
                ]),
            }),
        };

        const result = await strategy.forSale(ctx, [locationA], orderLine, 30);

        expect(result).toHaveLength(2);
        expect(result[0]).toEqual({
            location: locationA,
            quantity: 20,
            partitionKey: 'BATCH-001',
        });
        expect(result[1]).toEqual({
            location: locationA,
            quantity: 10,
            partitionKey: 'BATCH-002',
        });
    });

    it('forRelease preserves partitionKey from allocations', async () => {
        (strategy as any).connection = {
            getRepository: vi.fn().mockReturnValue({
                find: vi
                    .fn()
                    .mockResolvedValue([{ stockLocationId: '1', quantity: 15, partitionKey: 'BATCH-001' }]),
            }),
        };

        const result = await strategy.forRelease(ctx, [locationA], orderLine, 15);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            location: locationA,
            quantity: 15,
            partitionKey: 'BATCH-001',
        });
    });

    it('forCancellation preserves partitionKey from allocations', async () => {
        (strategy as any).connection = {
            getRepository: vi.fn().mockReturnValue({
                find: vi
                    .fn()
                    .mockResolvedValue([{ stockLocationId: '2', quantity: 5, partitionKey: 'BATCH-003' }]),
            }),
        };

        const result = await strategy.forCancellation(ctx, [locationB], orderLine, 5);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            location: locationB,
            quantity: 5,
            partitionKey: 'BATCH-003',
        });
    });

    it('backward compatible: default partition returns undefined partitionKey', async () => {
        (strategy as any).connection = {
            getRepository: vi.fn().mockReturnValue({
                find: vi.fn().mockResolvedValue([{ stockLocationId: '1', quantity: 10, partitionKey: '' }]),
            }),
        };

        const result = await strategy.forSale(ctx, [locationA], orderLine, 10);

        expect(result).toHaveLength(1);
        expect(result[0]).toEqual({
            location: locationA,
            quantity: 10,
            partitionKey: undefined,
        });
    });
});
