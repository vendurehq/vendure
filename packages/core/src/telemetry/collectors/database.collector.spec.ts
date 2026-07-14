import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { coreEntitiesMap } from '../../entity/entities';

import { DatabaseCollector } from './database.collector';

describe('DatabaseCollector', () => {
    let collector: DatabaseCollector;
    let mockConfigService: Record<string, any>;
    let mockConnection: Partial<TransactionalConnection>;
    let mockRepository: { count: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        mockRepository = { count: vi.fn().mockResolvedValue(50) };
        mockConnection = {
            rawConnection: {
                isInitialized: true,
                getRepository: vi.fn().mockReturnValue(mockRepository),
            } as any,
        };
        mockConfigService = {
            dbConnectionOptions: {
                type: 'postgres',
                entities: [],
            } as any,
        };
        collector = new DatabaseCollector(
            mockConfigService as ConfigService,
            mockConnection as TransactionalConnection,
        );
    });

    describe('database type normalization', () => {
        it('normalizes "better-sqlite3" to "sqlite"', async () => {
            mockConfigService.dbConnectionOptions = { type: 'better-sqlite3', entities: [] } as any;

            const result = await collector.collect();

            expect(result.databaseType).toBe('sqlite');
        });

        it('normalizes "sqlite" to "sqlite"', async () => {
            mockConfigService.dbConnectionOptions = { type: 'sqlite', entities: [] } as any;

            const result = await collector.collect();

            expect(result.databaseType).toBe('sqlite');
        });

        it('passes through "postgres"', async () => {
            mockConfigService.dbConnectionOptions = { type: 'postgres', entities: [] } as any;

            const result = await collector.collect();

            expect(result.databaseType).toBe('postgres');
        });

        it('passes through "mysql"', async () => {
            mockConfigService.dbConnectionOptions = { type: 'mysql', entities: [] } as any;

            const result = await collector.collect();

            expect(result.databaseType).toBe('mysql');
        });

        it('passes through "mariadb"', async () => {
            mockConfigService.dbConnectionOptions = { type: 'mariadb', entities: [] } as any;

            const result = await collector.collect();

            expect(result.databaseType).toBe('mariadb');
        });

        it('defaults to "other" for unsupported database types', async () => {
            mockConfigService.dbConnectionOptions = { type: 'oracle', entities: [] } as any;

            const result = await collector.collect();

            expect(result.databaseType).toBe('other');
        });
    });

    describe('entity metrics collection', () => {
        it('collects metrics for all core entities', async () => {
            const result = await collector.collect();

            const coreEntityNames = Object.keys(coreEntitiesMap);
            for (const name of coreEntityNames) {
                expect(result.metrics.entities[name]).toBeDefined();
            }
        });

        it('calls toRangeBucket for entity counts', async () => {
            // Verify that the collector uses range buckets (the actual bucket logic
            // is tested in range-bucket.helper.spec.ts)
            mockRepository.count.mockResolvedValue(0);

            const result = await collector.collect();

            // Count of 0 should result in '0' bucket
            expect(result.metrics.entities.Product).toBe('0');
        });

        it('handles count failures gracefully (returns 0 bucket)', async () => {
            mockRepository.count.mockRejectedValue(new Error('Database error'));

            const result = await collector.collect();

            // Should use '0' bucket for failed counts
            expect(result.metrics.entities.Product).toBe('0');
        });
    });

    describe('custom entity detection', () => {
        it('counts custom entities without collecting names', async () => {
            class CustomEntity {}
            class AnotherCustomEntity {}

            mockConfigService.dbConnectionOptions = {
                type: 'postgres',
                entities: [...Object.values(coreEntitiesMap), CustomEntity, AnotherCustomEntity],
            } as any;

            const result = await collector.collect();

            expect(result.metrics.custom.entityCount).toBe(2);
        });

        it('returns 0 custom entities when only core entities are present', async () => {
            mockConfigService.dbConnectionOptions = {
                type: 'postgres',
                entities: Object.values(coreEntitiesMap),
            } as any;

            const result = await collector.collect();

            expect(result.metrics.custom.entityCount).toBe(0);
            expect(result.metrics.custom.totalRecords).toBeUndefined();
        });

        it('includes totalRecords for custom entities when present', async () => {
            class CustomEntity {}
            mockRepository.count.mockResolvedValue(150);

            mockConfigService.dbConnectionOptions = {
                type: 'postgres',
                entities: [...Object.values(coreEntitiesMap), CustomEntity],
            } as any;

            const result = await collector.collect();

            expect(result.metrics.custom.entityCount).toBe(1);
            expect(result.metrics.custom.totalRecords).toBe('101-1k');
        });

        it('handles non-array entities config', async () => {
            mockConfigService.dbConnectionOptions = {
                type: 'postgres',
                entities: undefined,
            } as any;

            const result = await collector.collect();

            expect(result.metrics.custom.entityCount).toBe(0);
        });

        it('filters out non-function entities (string paths)', async () => {
            mockConfigService.dbConnectionOptions = {
                type: 'postgres',
                entities: [...Object.values(coreEntitiesMap), 'string-entity-path', { notAFunction: true }],
            } as any;

            const result = await collector.collect();

            expect(result.metrics.custom.entityCount).toBe(0);
        });

        it('sums total records from all custom entities', async () => {
            class CustomEntity1 {}
            class CustomEntity2 {}
            class CustomEntity3 {}

            const coreEntityCount = Object.keys(coreEntitiesMap).length;
            let callCount = 0;
            mockRepository.count.mockImplementation(() => {
                callCount++;
                // Core entities return 50, custom entities return specific values
                if (callCount > coreEntityCount) {
                    // Custom entity counts: 100, 200, 300 = 600 total
                    const customIndex = callCount - coreEntityCount;
                    return Promise.resolve(customIndex * 100);
                }
                return Promise.resolve(50);
            });

            mockConfigService.dbConnectionOptions = {
                type: 'postgres',
                entities: [...Object.values(coreEntitiesMap), CustomEntity1, CustomEntity2, CustomEntity3],
            } as any;

            const result = await collector.collect();

            expect(result.metrics.custom.entityCount).toBe(3);
            // 100 + 200 + 300 = 600 falls into '101-1k' bucket
            expect(result.metrics.custom.totalRecords).toBe('101-1k');
        });
    });
});
