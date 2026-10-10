import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { beforeEach, describe, expect, it } from 'vitest';

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
    /** The rows visible on the pool, i.e. committed data. */
    let committed: Channel[];
    /** The rows visible inside the transaction of `transactionalContext()`. */
    let inTransaction: Channel[];

    function repository(source: Source) {
        const rows = () => (source === 'pool' ? committed : inTransaction);
        return {
            count: () => {
                queries.push({ source });
                return Promise.resolve(rows().length);
            },
            findOne: ({ where }: any) => {
                queries.push({ source, where });
                return Promise.resolve(
                    rows().find(c => (where.token ? c.token === where.token : c.code === where.code)) ?? null,
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

    function tokenQueries(token: string) {
        return queries.filter(q => q.where?.token === token);
    }

    beforeEach(() => {
        queries = [];
        queryRunnerModes = [];
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

    it('shares one query between concurrent lookups of the same token', async () => {
        await Promise.all([
            service.getChannelFromToken('second-token'),
            service.getChannelFromToken('second-token'),
        ]);

        expect(tokenQueries('second-token')).toHaveLength(1);
    });

    it('loads a miss inside a transaction through that transaction without storing it', async () => {
        await service.getChannelFromToken(transactionalContext(), 'second-token');
        await service.getChannelFromToken('second-token');

        expect(tokenQueries('second-token').map(q => q.source)).toEqual(['transaction', 'pool']);
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
