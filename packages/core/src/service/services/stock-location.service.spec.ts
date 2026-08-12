import { beforeEach, describe, expect, it, vi } from 'vitest';

import { StockLevel } from '../../entity/stock-level/stock-level.entity';

/**
 * Tests for partitionKey preservation during StockLocation deletion with transfer.
 *
 * Validates that when a StockLocation is deleted and stock is transferred to
 * another location, each partition retains its identity (partitionKey, custom fields)
 * rather than being merged into a single StockLevel.
 */
describe('StockLocationService - partitionKey transfer on delete', () => {
    let service: any;
    let savedEntities: any[];
    let removedEntities: any[];

    const ctx = { channelId: '1', translate: (key: string) => key } as any;

    beforeEach(async () => {
        savedEntities = [];
        removedEntities = [];

        const { StockLocationService } = await import('./stock-location.service.js');

        // Construct service bypassing NestJS DI — only connection and eventBus matter for delete()
        service = new (StockLocationService as any)(
            /* requestContextService */ {},
            /* connection */ {
                findOneInChannel: vi.fn().mockResolvedValue({ id: '1', name: 'Location A' }),
                getRepository: vi.fn((_ctx: any, entity: any) => {
                    if (entity === StockLevel || entity?.name === 'StockLevel') {
                        return {
                            find: vi.fn().mockResolvedValue([
                                new StockLevel({
                                    id: '10',
                                    productVariantId: '42',
                                    stockLocationId: '1',
                                    stockOnHand: 30,
                                    stockAllocated: 5,
                                    partitionKey: 'BATCH-001',
                                }),
                                new StockLevel({
                                    id: '11',
                                    productVariantId: '42',
                                    stockLocationId: '1',
                                    stockOnHand: 50,
                                    stockAllocated: 10,
                                    partitionKey: 'BATCH-002',
                                }),
                            ]),
                            findOne: vi.fn().mockResolvedValue(null),
                            save: vi.fn((e: any) => {
                                savedEntities.push(e);
                                return Promise.resolve(e);
                            }),
                            remove: vi.fn((e: any) => {
                                removedEntities.push(e);
                                return Promise.resolve(e);
                            }),
                        };
                    }
                    // StockLocation repo
                    return {
                        find: vi.fn().mockResolvedValue([{ id: '1' }, { id: '2' }]),
                        remove: vi.fn().mockResolvedValue(undefined),
                    };
                }),
            },
            /* channelService */ {},
            /* roleService */ {},
            /* listQueryBuilder */ {},
            /* configService */ {},
            /* requestContextCache */ {},
            /* customFieldRelationService */ {},
            /* eventBus */ { publish: vi.fn() },
        );
    });

    it('preserves partitionKey when transferring stock to another location', async () => {
        await service.delete(ctx, { id: '1', transferToLocationId: '2' });

        // Two new StockLevels should be created at target location
        expect(savedEntities).toHaveLength(2);

        const batch1 = savedEntities.find((e: any) => e.partitionKey === 'BATCH-001');
        const batch2 = savedEntities.find((e: any) => e.partitionKey === 'BATCH-002');

        expect(batch1).toBeDefined();
        expect(batch1.stockLocationId).toBe('2');
        expect(batch1.productVariantId).toBe('42');
        expect(batch1.stockOnHand).toBe(30);
        expect(batch1.stockAllocated).toBe(5);

        expect(batch2).toBeDefined();
        expect(batch2.stockLocationId).toBe('2');
        expect(batch2.productVariantId).toBe('42');
        expect(batch2.stockOnHand).toBe(50);
        expect(batch2.stockAllocated).toBe(10);
    });

    it('does not merge different partitions into one StockLevel', async () => {
        await service.delete(ctx, { id: '1', transferToLocationId: '2' });

        expect(savedEntities).toHaveLength(2);
        const partitionKeys = savedEntities.map((e: any) => e.partitionKey);
        expect(partitionKeys).toContain('BATCH-001');
        expect(partitionKeys).toContain('BATCH-002');
    });

    it('removes original StockLevels after transfer', async () => {
        await service.delete(ctx, { id: '1', transferToLocationId: '2' });

        expect(removedEntities).toHaveLength(2);
    });
});
