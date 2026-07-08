import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ConfigService } from '../../config/config.service';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { Channel } from '../../entity/channel/channel.entity';
import { coreEntitiesMap } from '../../entity/entities';
import { Order } from '../../entity/order/order.entity';

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

    describe('order metrics', () => {
        // Values returned by orderRepo.count keyed by the query it represents.
        // The collector queries all four via distinct `where` clauses, and the
        // core entity-count pass also calls count() with no options.
        let counts: {
            placed: number | Error;
            active: number | Error;
            draft: number | Error;
            placedLast30d: number;
        };
        let getRawMany: ReturnType<typeof vi.fn>;
        let orderRepo: { count: ReturnType<typeof vi.fn>; createQueryBuilder: ReturnType<typeof vi.fn> };

        function resolveCount(options?: any): Promise<number> {
            const where = options?.where;
            if (!where) {
                // Core entity-count pass (repo.count() with no options)
                return Promise.resolve(50);
            }
            let value: number | Error;
            if ('active' in where) {
                value = counts.active;
            } else if ('state' in where) {
                value = counts.draft;
            } else if ('orderPlacedAt' in where) {
                // Not(IsNull()) → placed ; MoreThanOrEqual(date) → placedLast30d
                value =
                    where.orderPlacedAt?.type === 'moreThanOrEqual' ? counts.placedLast30d : counts.placed;
            } else {
                value = 0;
            }
            return value instanceof Error ? Promise.reject(value) : Promise.resolve(value);
        }

        beforeEach(() => {
            counts = { placed: 0, active: 0, draft: 0, placedLast30d: 0 };
            getRawMany = vi.fn().mockResolvedValue([]);
            const queryBuilder: any = {
                select: vi.fn().mockReturnThis(),
                addSelect: vi.fn().mockReturnThis(),
                groupBy: vi.fn().mockReturnThis(),
                getRawMany,
            };
            orderRepo = {
                count: vi.fn().mockImplementation(resolveCount),
                createQueryBuilder: vi.fn().mockReturnValue(queryBuilder),
            };
            // Route Order queries to orderRepo; everything else uses the default count repo
            (mockConnection.rawConnection as any).getRepository = vi
                .fn()
                .mockImplementation((entity: any) => {
                    if (entity === Order) {
                        return orderRepo;
                    }
                    return mockRepository;
                });
        });

        it('buckets placed / active / draft / placedLast30d counts', async () => {
            counts = { placed: 250, active: 3, draft: 0, placedLast30d: 120 };

            const result = await collector.collect();

            expect(result.metrics.orders?.placed).toBe('101-1k');
            expect(result.metrics.orders?.active).toBe('1-100');
            expect(result.metrics.orders?.draft).toBe('0');
            expect(result.metrics.orders?.placedLast30d).toBe('101-1k');
        });

        it('buckets order counts by type and omits empty types', async () => {
            getRawMany.mockResolvedValue([
                { type: 'Regular', count: '4200' },
                { type: 'Seller', count: '5' },
                { type: 'Aggregate', count: '0' },
            ]);

            const result = await collector.collect();

            expect(result.metrics.orders?.byType).toEqual({
                Regular: '1k-10k',
                Seller: '1-100',
            });
        });

        it('leaves a single field undefined when its query fails, keeping the others', async () => {
            counts = { placed: 10, active: new Error('boom'), draft: 2, placedLast30d: 5 };

            const result = await collector.collect();

            expect(result.metrics.orders?.placed).toBe('1-100');
            expect(result.metrics.orders?.active).toBeUndefined();
            expect(result.metrics.orders?.draft).toBe('1-100');
        });

        it('omits orders entirely when the DB is not initialized', async () => {
            (mockConnection.rawConnection as any).isInitialized = false;

            const result = await collector.collect();

            expect(result.metrics.orders).toBeUndefined();
        });
    });

    describe('i18n metrics', () => {
        beforeEach(() => {
            const channelRepo = {
                find: vi.fn().mockResolvedValue([
                    {
                        defaultLanguageCode: 'en',
                        availableLanguageCodes: ['en', 'de'],
                        defaultCurrencyCode: 'USD',
                        availableCurrencyCodes: ['USD', 'EUR'],
                    },
                    {
                        defaultLanguageCode: 'de',
                        availableLanguageCodes: ['de', 'fr'],
                        defaultCurrencyCode: 'EUR',
                        availableCurrencyCodes: ['EUR', 'GBP'],
                    },
                ]),
            };
            (mockConnection.rawConnection as any).getRepository = vi
                .fn()
                .mockImplementation((entity: any) => {
                    if (entity === Channel) {
                        return channelRepo;
                    }
                    return mockRepository;
                });
        });

        it('counts distinct languages and currencies across channels', async () => {
            const result = await collector.collect();

            // languages: en, de, fr → 3 ; currencies: USD, EUR, GBP → 3
            expect(result.metrics.i18n).toEqual({ languages: 3, currencies: 3 });
        });

        it('tolerates channels with null available* columns', async () => {
            (mockConnection.rawConnection as any).getRepository = vi
                .fn()
                .mockImplementation((entity: any) => {
                    if (entity === Channel) {
                        return {
                            find: vi.fn().mockResolvedValue([
                                {
                                    defaultLanguageCode: 'en',
                                    availableLanguageCodes: null,
                                    defaultCurrencyCode: 'USD',
                                    availableCurrencyCodes: null,
                                },
                            ]),
                        };
                    }
                    return mockRepository;
                });

            const result = await collector.collect();

            expect(result.metrics.i18n).toEqual({ languages: 1, currencies: 1 });
        });
    });
});
