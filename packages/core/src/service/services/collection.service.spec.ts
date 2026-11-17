import { JobState } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { NEVER } from 'rxjs';
import { UpsertType } from 'typeorm/driver/types/UpsertType';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Collection } from '../../entity/collection/collection.entity';
import { CollectionModificationEvent } from '../../event-bus/events/collection-modification-event';

import { ApplyCollectionFiltersJobData, CollectionService } from './collection.service';

/**
 * Unit tests for the `apply-collection-filters` job handler. The write which updates the
 * Collection <-> ProductVariant junction table used to be wrapped in a catch which only logged, so
 * a failed write was reported back as a successful run: the affected variants were reindexed
 * against membership rows which were never written, and the job settled as COMPLETED.
 */

const junctionEntityMetadata = {
    tableName: 'collection_product_variants_product_variant',
    ownerColumns: [{ databaseName: 'collectionId' }],
    inverseColumns: [{ databaseName: 'productVariantId' }],
};

type RecordedCall = { method: string; args: any[] };

/** A QueryBuilder which answers every call with itself, and every `getRawMany()` with `rawResults`. */
function mockQueryBuilder(rawResults: any[], recordInto?: RecordedCall[]): any {
    const qb: any = new Proxy(
        { getRawMany: () => Promise.resolve(rawResults) },
        {
            get: (target: any, prop) => {
                if (prop in target) {
                    return target[prop];
                }
                // Must not look like a thenable, or awaiting it would never settle.
                if (prop === 'then') {
                    return undefined;
                }
                return (...args: any[]) => {
                    recordInto?.push({ method: String(prop), args });
                    return String(prop) === 'execute' ? Promise.resolve() : qb;
                };
            },
        },
    );
    return qb;
}

describe('CollectionService apply-collection-filters job', () => {
    /** Resolves/rejects in place of the transaction which writes the membership rows. */
    let write: () => Promise<void>;
    let publish: ReturnType<typeof vi.fn>;
    let collections: Collection[];
    let supportedUpsertTypes: UpsertType[];
    /** One entry per QueryBuilder created inside the write transaction. */
    let writeQueryBuilders: RecordedCall[][];
    let process: (job: any) => Promise<any>;

    function mockJob(data: Partial<ApplyCollectionFiltersJobData> = {}) {
        return {
            state: JobState.RUNNING,
            setProgress: vi.fn(),
            data: {
                ctx: { channelToken: 'test-channel', languageCode: 'en' },
                collectionIds: collections.map(c => c.id),
                ...data,
            },
        };
    }

    /** The calls made on the QueryBuilder which inserted the new membership rows. */
    function insertCalls(): RecordedCall[] {
        return writeQueryBuilders.find(calls => calls.some(call => call.method === 'insert')) ?? [];
    }

    beforeEach(async () => {
        write = () => Promise.resolve();
        publish = vi.fn();
        supportedUpsertTypes = ['on-conflict-do-update'];
        writeQueryBuilders = [];
        collections = [new Collection({ id: 42, inheritFilters: false, filters: [] })];

        // Every query issued before the write reports a single variant which needs adding, so that
        // a successful run has something to write and to publish a CollectionModificationEvent for.
        const masterConnection = {
            getRepository: () => ({ createQueryBuilder: () => mockQueryBuilder([{ id: 1 }]) }),
            createQueryBuilder: () => mockQueryBuilder([{ id: 1 }]),
        };
        const transactionalEntityManager = {
            createQueryBuilder: () => {
                const calls: RecordedCall[] = [];
                writeQueryBuilders.push(calls);
                return mockQueryBuilder([], calls);
            },
        };
        const mockConnection = {
            getEntityOrThrow: (ctx: any, entity: any, id: ID) => {
                const collection = collections.find(c => c.id === id);
                return collection ? Promise.resolve(collection) : Promise.reject(new Error('not found'));
            },
            rawConnection: {
                driver: {
                    get supportedUpsertTypes() {
                        return supportedUpsertTypes;
                    },
                },
                createQueryRunner: () => ({ connection: masterConnection }),
                getMetadata: () => ({
                    findRelationWithPropertyPath: () => ({ junctionEntityMetadata }),
                }),
                transaction: (cb: (em: any) => Promise<void>) =>
                    write().then(() => cb(transactionalEntityManager)),
            },
        } as any;

        const mockJobQueueService = {
            createQueue: vi.fn((config: any) => {
                process = config.process;
                return Promise.resolve({ add: vi.fn() });
            }),
        } as any;

        const service = new CollectionService(
            mockConnection,
            {} as any,
            {} as any,
            {} as any,
            {} as any,
            { ofType: () => NEVER, publish } as any,
            mockJobQueueService,
            { catalogOptions: { collectionFilters: [] } } as any,
            {} as any,
            {} as any,
            {} as any,
            { translate: (collection: Collection) => collection } as any,
            {} as any,
            { create: () => Promise.resolve({}) } as any,
            {} as any,
        );
        await service.onModuleInit();
    });

    describe('reporting failures', () => {
        it('completes and publishes the modification when the membership write succeeds', async () => {
            const result = await process(mockJob());

            expect(result).toEqual({ processedCollections: 1 });
            expect(publish).toHaveBeenCalledTimes(1);
            expect(publish.mock.calls[0][0]).toBeInstanceOf(CollectionModificationEvent);
        });

        it('fails the job when the membership write fails, rather than reporting a successful run', async () => {
            const queryFailed = new Error(
                'duplicate key value violates unique constraint "PK_6faa7b72422d9c4f5f5db35f8e0"',
            );
            queryFailed.name = 'QueryFailedError';
            write = () => Promise.reject(queryFailed);

            await expect(process(mockJob())).rejects.toThrow(
                /Could not apply the filters of 1 of 1 Collections \(ids: 42 \(QueryFailedError: duplicate key value/,
            );
            // Nothing may be reindexed against membership rows which were not written.
            expect(publish).not.toHaveBeenCalled();
        });

        it('still processes the other Collections in the batch when one of them fails', async () => {
            collections = [
                new Collection({ id: 42, inheritFilters: false, filters: [] }),
                new Collection({ id: 43, inheritFilters: false, filters: [] }),
            ];
            let attempt = 0;
            write = () => (attempt++ === 0 ? Promise.reject(new Error('boom')) : Promise.resolve());

            await expect(process(mockJob())).rejects.toThrow(
                'Could not apply the filters of 1 of 2 Collections (ids: 42 (Error: boom)). ' +
                    'See the preceding errors for details.',
            );
            expect(publish).toHaveBeenCalledTimes(1);
        });

        it('keeps the message within the length of the JobRecord error column', async () => {
            collections = Array.from(
                { length: 20 },
                (_, i) => new Collection({ id: i + 1, inheritFilters: false, filters: [] }),
            );
            write = () => Promise.reject(new Error('x'.repeat(500)));

            const error: Error = await process(mockJob()).catch((e: Error) => e);

            expect(error.message).toMatch(
                /^Could not apply the filters of 20 of 20 Collections \(ids: 1 \(Error: x+\.\.\.\), /,
            );
            expect(error.message).toContain('See the preceding errors for details.');
            expect(error.message.length).toBeLessThanOrEqual(255);
            expect(error.message).not.toContain('\n');
        });
    });

    describe('tolerating rows which are already there', () => {
        it('names the junction table and its columns from the relation metadata', async () => {
            await process(mockJob());

            expect(insertCalls()).toContainEqual({
                method: 'into',
                args: [junctionEntityMetadata.tableName, ['collectionId', 'productVariantId']],
            });
            expect(insertCalls()).toContainEqual({
                method: 'values',
                args: [[{ collectionId: 42, productVariantId: 1 }]],
            });
        });

        it('uses ON CONFLICT DO NOTHING where the driver supports it', async () => {
            supportedUpsertTypes = ['on-conflict-do-update'];

            await process(mockJob());

            expect(insertCalls().map(call => call.method)).toContain('orIgnore');
            expect(insertCalls().map(call => call.method)).not.toContain('orUpdate');
        });

        it('uses a no-op ON DUPLICATE KEY UPDATE on MySQL & MariaDB, not INSERT IGNORE', async () => {
            supportedUpsertTypes = ['on-duplicate-key-update'];

            await process(mockJob());

            // `orIgnore()` would compile to `INSERT IGNORE`, which also downgrades unrelated errors
            // such as foreign key and not-null violations to warnings.
            expect(insertCalls().map(call => call.method)).not.toContain('orIgnore');
            expect(insertCalls()).toContainEqual({ method: 'orUpdate', args: [['collectionId']] });
        });

        it('leaves the insert alone on drivers whose only upsert form is MERGE INTO', async () => {
            // TypeORM compiles a conflict clause on mssql/oracle/sap to `MERGE INTO`, which needs
            // the target table's entity metadata. The junction table has none, so asking for one
            // would throw where the previous plain insert simply worked.
            supportedUpsertTypes = ['merge-into'];

            await process(mockJob());

            const methods = insertCalls().map(call => call.method);
            expect(methods).not.toContain('orIgnore');
            expect(methods).not.toContain('orUpdate');
            expect(methods).toContain('execute');
        });
    });
});
