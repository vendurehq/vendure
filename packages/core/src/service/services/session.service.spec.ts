import { TransactionCommitEvent, TransactionRollbackEvent } from 'typeorm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { TRANSACTION_MANAGER_KEY } from '../../common/constants';
import { Logger } from '../../config/logger/vendure-logger';
import { CachedSession } from '../../config/session-cache/session-cache-strategy';
import { Order } from '../../entity/order/order.entity';
import { AnonymousSession } from '../../entity/session/anonymous-session.entity';

import { SessionService } from './session.service';

function deferred() {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<void>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

// #5625: preserve committed session state and the existing cache completion behavior.
describe('SessionService active order caching', () => {
    let service: SessionService;
    let row: AnonymousSession;
    let cache: Map<string, CachedSession>;
    let cacheStrategy: {
        get: ReturnType<typeof vi.fn>;
        set: ReturnType<typeof vi.fn>;
        delete: ReturnType<typeof vi.fn>;
        clear: ReturnType<typeof vi.fn>;
    };
    let primaryRead: ReturnType<typeof vi.fn>;
    let createQueryRunner: ReturnType<typeof vi.fn>;
    let release: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.useFakeTimers();
        cache = new Map();
        row = new AnonymousSession({
            id: 1,
            token: 'session-token',
            expires: new Date(Date.now() + 3_600_000),
            invalidated: false,
            activeOrderId: 123,
            activeOrder: new Order({ id: 123 }),
        });
        cacheStrategy = {
            get: vi.fn((token: string) => Promise.resolve(cache.get(token))),
            set: vi.fn((session: CachedSession) => {
                cache.set(session.token, session);
                return Promise.resolve();
            }),
            delete: vi.fn((token: string) => {
                cache.delete(token);
                return Promise.resolve();
            }),
            clear: vi.fn(() => {
                cache.clear();
                return Promise.resolve();
            }),
        };
        primaryRead = vi.fn(() => Promise.resolve(new AnonymousSession(row)));
        function queryBuilder(getOne: () => Promise<AnonymousSession>) {
            return {
                leftJoinAndSelect() {
                    return this;
                },
                where() {
                    return this;
                },
                andWhere() {
                    return this;
                },
                getOne,
            };
        }
        const repository = {
            findOne: () => Promise.resolve(new AnonymousSession(row)),
            save: (session: AnonymousSession) => {
                Object.assign(session, { activeOrderId: session.activeOrder?.id ?? null });
                Object.assign(row, session);
                return Promise.resolve(session);
            },
            createQueryBuilder: () => queryBuilder(primaryRead),
        };
        release = vi.fn(() => Promise.resolve());
        createQueryRunner = vi.fn(() => ({ manager: { getRepository: () => repository }, release }));
        const connection = {
            getRepository: () => repository,
            rawConnection: {
                subscribers: [],
                createQueryRunner,
                // A lagging replica has not received the committed active-order link.
                getRepository: () => ({
                    createQueryBuilder: () =>
                        queryBuilder(() =>
                            Promise.resolve(new AnonymousSession({ ...row, activeOrderId: undefined })),
                        ),
                }),
            },
        };
        service = new SessionService(
            connection as any,
            {
                authOptions: {
                    sessionCacheStrategy: cacheStrategy,
                    sessionDuration: '1h',
                    sessionCacheTTL: 60,
                },
            } as any,
            {} as any,
            {} as any,
            {} as any,
        );
    });

    afterEach(() => {
        vi.clearAllTimers();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    function primeCache() {
        const session = service.serializeSession(row);
        cache.set(session.token, session);
        return session;
    }

    async function prepareTransaction() {
        const queryRunner = { isTransactionActive: true };
        const ctx = RequestContext.empty();
        (ctx as any)[TRANSACTION_MANAGER_KEY] = { queryRunner };
        await service.unsetActiveOrder(ctx, primeCache());
        queryRunner.isTransactionActive = false;
        return { queryRunner } as TransactionCommitEvent & TransactionRollbackEvent;
    }

    it('refills a cache miss from the primary rather than a lagging replica', async () => {
        const session = await service.getSessionFromToken(row.token);

        expect(session?.activeOrderId).toBe(123);
        expect(cache.get(row.token)?.activeOrderId).toBe(123);
        expect(createQueryRunner).toHaveBeenCalledWith('master');
        expect(release).toHaveBeenCalledOnce();
    });

    it('releases the primary connection if the refill query fails', async () => {
        primaryRead.mockRejectedValueOnce(new Error('Primary unavailable'));

        await expect(service.getSessionFromToken(row.token)).rejects.toThrow('Primary unavailable');
        expect(release).toHaveBeenCalledOnce();
    });

    it('waits for a non-transactional unset cache write even after 50ms', async () => {
        const write = deferred();
        cacheStrategy.set.mockImplementation(async (session: CachedSession) => {
            await write.promise;
            cache.set(session.token, session);
        });
        let completed = false;
        const result = service.unsetActiveOrder(RequestContext.empty(), primeCache()).then(() => {
            completed = true;
        });

        await vi.advanceTimersByTimeAsync(75);
        expect(completed).toBe(false);
        expect(cache.get(row.token)?.activeOrderId).toBe(123);
        write.resolve();
        await result;
        expect(cache.get(row.token)?.activeOrderId).toBeNull();
    });

    it('propagates a late non-transactional unset cache write rejection', async () => {
        const write = deferred();
        cacheStrategy.set.mockImplementation(() => write.promise);
        const result = service.unsetActiveOrder(RequestContext.empty(), primeCache()).then(
            () => undefined,
            (cause: Error) => cause,
        );

        await vi.advanceTimersByTimeAsync(75);
        const error = new Error('Cache write failed');
        write.reject(error);
        expect(await result).toBe(error);
    });

    it('keeps the existing timeout for a non-transactional set cache write', async () => {
        const write = deferred();
        cacheStrategy.set.mockImplementation(() => write.promise);
        const result = service.setActiveOrder(RequestContext.empty(), primeCache(), new Order({ id: 456 }));

        await vi.advanceTimersByTimeAsync(50);
        expect((await result).activeOrderId).toBe(456);
        write.resolve();
    });

    it.each(['commit', 'rollback'] as const)(
        'logs a timed-out deletion and its late rejection after %s',
        async outcome => {
            const event = await prepareTransaction();
            const deletion = deferred();
            cacheStrategy.delete.mockImplementation(() => deletion.promise);
            const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
            const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
            let completed = false;
            const result = (
                outcome === 'commit'
                    ? service.afterTransactionCommit(event)
                    : service.afterTransactionRollback(event)
            ).then(() => {
                completed = true;
            });

            await vi.advanceTimersByTimeAsync(49);
            expect(completed).toBe(false);
            expect(warn).not.toHaveBeenCalled();
            await vi.advanceTimersByTimeAsync(1);
            await result;
            expect(warn).toHaveBeenCalledWith(expect.stringContaining('timed out'));
            expect(error).not.toHaveBeenCalled();

            deletion.reject(new Error('Late delete failure'));
            await vi.advanceTimersByTimeAsync(0);
            expect(error).toHaveBeenCalledWith(expect.stringContaining('Late delete failure'));
        },
    );

    it('does not report a successful deletion as a timeout', async () => {
        const event = await prepareTransaction();
        const warn = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
        const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);

        await service.afterTransactionCommit(event);

        expect(cache.has(row.token)).toBe(false);
        expect(warn).not.toHaveBeenCalled();
        expect(error).not.toHaveBeenCalled();
    });

    it('logs a synchronous deletion error without rejecting the transaction hook', async () => {
        const event = await prepareTransaction();
        cacheStrategy.delete.mockImplementation(() => {
            throw new Error('Delete failed');
        });
        const error = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);

        await expect(service.afterTransactionCommit(event)).resolves.toBeUndefined();
        expect(error).toHaveBeenCalledWith(expect.stringContaining('Delete failed'));
    });
});
