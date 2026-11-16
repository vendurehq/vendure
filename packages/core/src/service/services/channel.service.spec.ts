import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { TRANSACTION_MANAGER_KEY } from '../../common/constants';
import { Channel } from '../../entity/channel/channel.entity';
import { ChannelEvent } from '../../event-bus/events/channel-event';

import { ChannelService } from './channel.service';

/**
 * Unit tests for the per-process Channel cache (#988). Each test counts the queries which reach
 * the repository, and records whether they ran on the pool or through a transaction.
 */

type Source = 'pool' | 'transaction';

describe('ChannelService cache', () => {
    let service: ChannelService;
    let subscribedEvent: unknown;
    let onChannelEvent: () => void;
    let queryRunnerModes: string[];
    let queries: Array<{ source: Source; where?: any }>;
    /** When set, queries on the pool never return, like when the pool is exhausted. */
    let poolStalled: boolean;
    /** The rows visible on the pool, i.e. committed data. */
    let committed: Channel[];
    /** The rows visible inside the transaction of `transactionalContext()`. */
    let inTransaction: Channel[];

    function repository(source: Source) {
        const rows = () => (source === 'pool' ? committed : inTransaction);
        const stalled = () => source === 'pool' && poolStalled;
        return {
            count: () => {
                queries.push({ source });
                return stalled() ? new Promise(() => undefined) : Promise.resolve(rows().length);
            },
            findOne: ({ where }: any) => {
                queries.push({ source, where });
                if (stalled()) {
                    return new Promise(() => undefined);
                }
                // Tokens are compared case-insensitively, like a MySQL `_ci` collation
                return Promise.resolve(
                    rows().find(c =>
                        where.token
                            ? c.token.toLowerCase() === where.token.toLowerCase()
                            : c.code === where.code,
                    ) ?? null,
                );
            },
        };
    }

    const transactionManager = { getRepository: () => repository('transaction') };

    function transactionalContext() {
        const ctx = RequestContext.empty();
        (ctx as any)[TRANSACTION_MANAGER_KEY] = transactionManager;
        return ctx;
    }

    /** Lets loads started in the background resolve. */
    function backgroundLoads() {
        return new Promise(resolve => setImmediate(resolve));
    }

    function tokenQueries(token: string) {
        return queries.filter(q => q.where?.token === token);
    }

    beforeEach(() => {
        queries = [];
        queryRunnerModes = [];
        poolStalled = false;
        committed = [
            new Channel({ id: 1, code: DEFAULT_CHANNEL_CODE, token: 'default-token' }),
            new Channel({ id: 2, code: 'second', token: 'second-token' }),
            new Channel({ id: 3, code: 'third', token: 'third-token' }),
        ];
        inTransaction = [...committed];
        const connection = {
            rawConnection: {
                createQueryRunner: (mode: string) => {
                    queryRunnerModes.push(mode);
                    return {
                        manager: { getRepository: () => repository('pool') },
                        release: () => Promise.resolve(),
                    };
                },
            },
            getEntityOrThrow: (_ctx: any, _entity: any, id: number) =>
                Promise.resolve(committed.find(c => c.id === id)),
            getRepository: () => ({ delete: () => Promise.resolve() }),
        };
        const eventBus = {
            ofType: (type: unknown) => {
                subscribedEvent = type;
                return { subscribe: (fn: () => void) => (onChannelEvent = fn) };
            },
            publish: () => Promise.resolve(),
        };
        service = new ChannelService(
            connection as any,
            { entityOptions: { channelCacheTtl: 30_000 } } as any,
            {} as any,
            {} as any,
            eventBus as any,
            {} as any,
        );
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('queries a known token once', async () => {
        await service.getChannelFromToken('second-token');
        await service.getChannelFromToken('second-token');

        expect(tokenQueries('second-token')).toHaveLength(1);
        // Cache loads read from the master, so replica lag is not cached for the whole TTL
        expect(new Set(queryRunnerModes)).toEqual(new Set(['master']));
    });

    it('queries an unknown token once', async () => {
        await expect(service.getChannelFromToken('unknown')).rejects.toThrow('error.channel-not-found');
        await expect(service.getChannelFromToken('unknown')).rejects.toThrow('error.channel-not-found');

        expect(tokenQueries('unknown')).toHaveLength(1);
    });

    it('does not match a token which differs only in case', async () => {
        await expect(service.getChannelFromToken('SECOND-TOKEN')).rejects.toThrow('error.channel-not-found');
    });

    it('shares one query between concurrent lookups of the same token', async () => {
        await Promise.all([
            service.getChannelFromToken('second-token'),
            service.getChannelFromToken('second-token'),
        ]);

        expect(tokenQueries('second-token')).toHaveLength(1);
    });

    it('loads a miss inside a transaction through that transaction and fills the cache in the background', async () => {
        await service.getChannelFromToken(transactionalContext(), 'second-token');
        await backgroundLoads();
        await service.getChannelFromToken(transactionalContext(), 'second-token');
        await service.getChannelFromToken('second-token');

        expect(
            tokenQueries('second-token')
                .map(q => q.source)
                .sort(),
        ).toEqual(['pool', 'transaction']);
    });

    it('does not wait inside a transaction for a cache load which is still in flight', async () => {
        poolStalled = true;
        void service.getChannelFromToken('second-token');

        const channel = await service.getChannelFromToken(transactionalContext(), 'second-token');
        expect(channel.id).toBe(2);
    });

    it('fills the default Channel cache from inside a transaction', async () => {
        await service.getDefaultChannel(transactionalContext());
        await backgroundLoads();
        await service.getDefaultChannel(transactionalContext());

        expect(
            queries
                .filter(q => q.where?.code === DEFAULT_CHANNEL_CODE)
                .map(q => q.source)
                .sort(),
        ).toEqual(['pool', 'transaction']);
    });

    it('queries a token again after the TTL expires', async () => {
        vi.useFakeTimers();
        await service.getChannelFromToken('second-token');
        vi.advanceTimersByTime(30_001);
        await service.getChannelFromToken('second-token');

        expect(tokenQueries('second-token')).toHaveLength(2);
    });

    it('does not evict the count or the default Channel when unknown tokens fill the miss cache', async () => {
        await service.getDefaultChannel();
        for (let i = 0; i < 1_001; i++) {
            await expect(service.getChannelFromToken(`unknown-${i}`)).rejects.toThrow();
        }
        await service.getDefaultChannel();

        expect(queries.filter(q => !q.where)).toHaveLength(1);
        expect(queries.filter(q => q.where?.code === DEFAULT_CHANNEL_CODE)).toHaveLength(1);
        // The oldest miss was evicted, so it is queried again
        await expect(service.getChannelFromToken('unknown-0')).rejects.toThrow();
        expect(tokenQueries('unknown-0')).toHaveLength(2);
    });

    it('uses a cached Channel inside a transaction', async () => {
        await service.getChannelFromToken('second-token');
        await service.getChannelFromToken(transactionalContext(), 'second-token');

        expect(tokenQueries('second-token')).toHaveLength(1);
    });

    it('ignores a cached miss inside a transaction', async () => {
        await expect(service.getChannelFromToken('later-token')).rejects.toThrow('error.channel-not-found');
        inTransaction.push(new Channel({ id: 4, code: 'later', token: 'later-token' }));

        const channel = await service.getChannelFromToken(transactionalContext(), 'later-token');
        expect(channel.id).toBe(4);
    });

    it('skips the cache in a transaction which has written a Channel', async () => {
        const ctx = transactionalContext();
        await service.delete(ctx, 2);
        inTransaction = inTransaction.filter(c => c.id !== 2);

        // Another request refills the cache from the committed data before the transaction ends
        await service.getChannelFromToken('second-token');

        await expect(service.getChannelFromToken(ctx, 'second-token')).rejects.toThrow(
            'error.channel-not-found',
        );
    });

    it('clears the cache when a ChannelEvent is published', async () => {
        await service.getChannelFromToken('second-token');
        expect(subscribedEvent).toBe(ChannelEvent);
        onChannelEvent();
        await service.getChannelFromToken('second-token');

        expect(tokenQueries('second-token')).toHaveLength(2);
    });
});
