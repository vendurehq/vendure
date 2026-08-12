import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_STOCK_LOCATION_PARTITION_KEY } from '../../common/constants';
import { StockLevel } from '../../entity/stock-level/stock-level.entity';

import { StockLevelService } from './stock-level.service';

/**
 * In-memory mock repository that simulates TypeORM behavior for StockLevel.
 */
function createMockRepository() {
    const store: StockLevel[] = [];
    let nextId = 1;

    return {
        store,
        findOne: vi.fn(async ({ where }: { where: Record<string, any> }) => {
            return (
                store.find(item =>
                    Object.entries(where).every(([key, value]) => (item as any)[key] === value),
                ) ?? null
            );
        }),
        save: vi.fn(async (entity: StockLevel) => {
            const saved = new StockLevel({
                ...entity,
                id: entity.id ?? nextId++,
            });
            if (saved.partitionKey === undefined || saved.partitionKey === null) {
                saved.partitionKey = DEFAULT_STOCK_LOCATION_PARTITION_KEY;
            }
            store.push(saved);
            return saved;
        }),
        update: vi.fn(async (id: number, partial: Partial<StockLevel>) => {
            const item = store.find(s => s.id === id);
            if (item) {
                Object.assign(item, partial);
            }
        }),
    };
}

describe('StockLevelService - partitionKey', () => {
    let repo: ReturnType<typeof createMockRepository>;
    let service: StockLevelService;
    const ctx = {} as any;
    const variantId = '42';
    const locationId = '1';

    beforeEach(() => {
        repo = createMockRepository();
        const mockConnection = { getRepository: vi.fn(() => repo) };
        const mockConfigService = { catalogOptions: { stockLocationStrategy: {} } };
        const mockStockLocationService = {};

        // Construct service bypassing NestJS DI
        service = new (StockLevelService as any)(mockConnection, mockStockLocationService, mockConfigService);
    });

    describe('getStockLevel()', () => {
        it('creates a new StockLevel with default partitionKey when none exists', async () => {
            const result = await service.getStockLevel(ctx, variantId, locationId);
            expect(result.productVariantId).toBe(variantId);
            expect(result.stockLocationId).toBe(locationId);
            expect(result.stockOnHand).toBe(0);
            expect(result.stockAllocated).toBe(0);
            expect(result.partitionKey).toBe(DEFAULT_STOCK_LOCATION_PARTITION_KEY);
        });

        it('returns existing default-partition StockLevel on second call', async () => {
            const first = await service.getStockLevel(ctx, variantId, locationId);
            const result = await service.getStockLevel(ctx, variantId, locationId);
            expect(result.id).toBe(first.id);
            expect(result.partitionKey).toBe(DEFAULT_STOCK_LOCATION_PARTITION_KEY);
            expect(repo.save).toHaveBeenCalledTimes(1);
        });

        it('creates a StockLevel with a specific partitionKey', async () => {
            const result = await service.getStockLevel(ctx, variantId, locationId, 'BATCH-001');
            expect(result.partitionKey).toBe('BATCH-001');
            expect(result.productVariantId).toBe(variantId);
            expect(result.stockLocationId).toBe(locationId);
        });

        it('allows multiple StockLevels with different partitionKeys for same variant+location', async () => {
            const batch1 = await service.getStockLevel(ctx, variantId, locationId, 'BATCH-001');
            const batch2 = await service.getStockLevel(ctx, variantId, locationId, 'BATCH-002');

            expect(batch1.id).not.toBe(batch2.id);
            expect(batch1.partitionKey).toBe('BATCH-001');
            expect(batch2.partitionKey).toBe('BATCH-002');
            expect(repo.store).toHaveLength(2);
        });

        it('returns the correct StockLevel when partitionKey is specified', async () => {
            await service.getStockLevel(ctx, variantId, locationId, 'BATCH-001');
            await service.getStockLevel(ctx, variantId, locationId, 'BATCH-002');

            const result = await service.getStockLevel(ctx, variantId, locationId, 'BATCH-001');
            expect(result.partitionKey).toBe('BATCH-001');
            expect(repo.save).toHaveBeenCalledTimes(2); // Only 2 creates, third was a lookup
        });
    });

    describe('updateStockOnHandForLocation()', () => {
        it('updates stock without partitionKey (default behavior)', async () => {
            await service.getStockLevel(ctx, variantId, locationId);
            await service.updateStockOnHandForLocation(ctx, variantId, locationId, 10);

            expect(repo.update).toHaveBeenCalledWith(1, { stockOnHand: 10 });
        });

        it('updates only the targeted partition when partitionKey is provided', async () => {
            await service.getStockLevel(ctx, variantId, locationId, 'BATCH-001');
            await service.getStockLevel(ctx, variantId, locationId, 'BATCH-002');

            await service.updateStockOnHandForLocation(ctx, variantId, locationId, 50, 'BATCH-001');

            expect(repo.update).toHaveBeenCalledWith(1, { stockOnHand: 50 });
            expect(repo.update).toHaveBeenCalledTimes(1);
        });

        it('creates a new StockLevel if partitionKey does not exist yet', async () => {
            await service.updateStockOnHandForLocation(ctx, variantId, locationId, 25, 'NEW-BATCH');

            expect(repo.save).toHaveBeenCalledTimes(1);
            const saved = repo.store[0];
            expect(saved.partitionKey).toBe('NEW-BATCH');
            expect(saved.stockOnHand).toBe(25);
        });
    });

    describe('updateStockAllocatedForLocation()', () => {
        it('updates allocation without partitionKey (default behavior)', async () => {
            await service.getStockLevel(ctx, variantId, locationId);
            await service.updateStockAllocatedForLocation(ctx, variantId, locationId, 5);

            expect(repo.update).toHaveBeenCalledWith(1, { stockAllocated: 5 });
        });

        it('updates only the targeted partition when partitionKey is provided', async () => {
            await service.getStockLevel(ctx, variantId, locationId, 'BATCH-001');
            const batch2 = await service.getStockLevel(ctx, variantId, locationId, 'BATCH-002');

            await service.updateStockAllocatedForLocation(ctx, variantId, locationId, 3, 'BATCH-002');

            expect(repo.update).toHaveBeenCalledWith(batch2.id, { stockAllocated: 3 });
        });

        it('does nothing if partitionKey does not match any existing StockLevel', async () => {
            await service.getStockLevel(ctx, variantId, locationId, 'BATCH-001');
            await service.updateStockAllocatedForLocation(ctx, variantId, locationId, 5, 'NONEXISTENT');

            expect(repo.update).not.toHaveBeenCalled();
        });
    });
});
