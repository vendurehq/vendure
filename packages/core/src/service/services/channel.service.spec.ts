import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { describe, expect, it, vi } from 'vitest';

import { RequestContext } from '../../api/common/request-context';
import { ConfigService } from '../../config/config.service';
import { Channel } from '../../entity/channel/channel.entity';

import { ChannelService } from './channel.service';

describe('ChannelService cache', () => {
    it('returns the default Channel directly from the cache', async () => {
        const channel = createChannel();
        const { service, channelCacheStrategy, repository } = createService({ cachedDefault: channel });

        const result = await service.getDefaultChannel(RequestContext.empty());

        expect(result).toBe(channel);
        expect(channelCacheStrategy.getDefault).toHaveBeenCalledOnce();
        expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('returns a Channel by token directly from the cache', async () => {
        const channel = createChannel({ code: 'secondary', token: 'secondary-token' });
        const { service, channelCacheStrategy, repository } = createService({
            cachedByToken: channel,
        });

        const result = await service.getChannelFromToken(RequestContext.empty(), channel.token);

        expect(result).toBe(channel);
        expect(channelCacheStrategy.getByToken).toHaveBeenCalledWith('secondary-token');
        expect(repository.findOne).not.toHaveBeenCalled();
    });

    it('loads and stores only the default Channel on a cache miss', async () => {
        const channel = createChannel();
        const { service, channelCacheStrategy, repository } = createService({ databaseChannel: channel });

        const result = await service.getDefaultChannel(RequestContext.empty());

        expect(result).toBe(channel);
        expect(repository.findOne).toHaveBeenCalledWith({
            where: { code: DEFAULT_CHANNEL_CODE },
            relations: { defaultShippingZone: true, defaultTaxZone: true },
        });
        expect(channelCacheStrategy.set).toHaveBeenCalledWith(channel);
    });

    it('loads and stores only the requested token on a cache miss', async () => {
        const channel = createChannel({ code: 'secondary', token: 'secondary-token' });
        const { service, channelCacheStrategy, repository } = createService({ databaseChannel: channel });

        const result = await service.getChannelFromToken(RequestContext.empty(), channel.token);

        expect(result).toBe(channel);
        expect(repository.findOne).toHaveBeenCalledWith({
            where: { token: 'secondary-token' },
            relations: { defaultShippingZone: true, defaultTaxZone: true },
        });
        expect(channelCacheStrategy.set).toHaveBeenCalledWith(channel);
        expect(repository.count).not.toHaveBeenCalled();
    });

    it('coalesces concurrent misses for the same token into one database lookup', async () => {
        const channel = createChannel({ code: 'secondary', token: 'secondary-token' });
        const { service, channelCacheStrategy, repository } = createService({
            databaseChannel: channel,
        });

        const results = await Promise.all([
            service.getChannelFromToken(RequestContext.empty(), channel.token),
            service.getChannelFromToken(RequestContext.empty(), channel.token),
            service.getChannelFromToken(RequestContext.empty(), channel.token),
        ]);

        expect(results).toEqual([channel, channel, channel]);
        expect(channelCacheStrategy.getByToken).toHaveBeenCalledOnce();
        expect(repository.findOne).toHaveBeenCalledOnce();
        expect(channelCacheStrategy.set).toHaveBeenCalledOnce();
    });

    it('does not coalesce concurrent misses for different tokens', async () => {
        const first = createChannel({ id: 2, code: 'first', token: 'first-token' });
        const second = createChannel({ id: 3, code: 'second', token: 'second-token' });
        const { service, repository } = createService({ databaseChannel: first });
        repository.findOne.mockImplementation(({ where }: any) =>
            Promise.resolve(where.token === first.token ? first : second),
        );

        const results = await Promise.all([
            service.getChannelFromToken(RequestContext.empty(), first.token),
            service.getChannelFromToken(RequestContext.empty(), second.token),
        ]);

        expect(results).toEqual([first, second]);
        expect(repository.findOne).toHaveBeenCalledTimes(2);
    });

    it('coalesces concurrent misses for the default Channel', async () => {
        const channel = createChannel();
        const { service, channelCacheStrategy, repository } = createService({
            databaseChannel: channel,
        });

        const results = await Promise.all([
            service.getDefaultChannel(RequestContext.empty()),
            service.getDefaultChannel(RequestContext.empty()),
        ]);

        expect(results).toEqual([channel, channel]);
        expect(channelCacheStrategy.getDefault).toHaveBeenCalledOnce();
        expect(repository.findOne).toHaveBeenCalledOnce();
    });

    it('allows a failed single-flight lookup to be retried', async () => {
        const channel = createChannel({ code: 'secondary', token: 'secondary-token' });
        const { service, repository } = createService({ databaseChannel: channel });
        repository.findOne.mockRejectedValueOnce(new Error('database unavailable'));

        await expect(service.getChannelFromToken(RequestContext.empty(), channel.token)).rejects.toThrow(
            'database unavailable',
        );
        await expect(service.getChannelFromToken(RequestContext.empty(), channel.token)).resolves.toBe(
            channel,
        );

        expect(repository.findOne).toHaveBeenCalledTimes(2);
    });

    it('preserves the single-Channel fallback for an unknown token', async () => {
        const defaultChannel = createChannel();
        const { service, repository } = createService({
            cachedDefault: defaultChannel,
            channelCount: 1,
        });

        const result = await service.getChannelFromToken(RequestContext.empty(), 'unknown-token');

        expect(repository.count).toHaveBeenCalledOnce();
        expect(result).toBe(defaultChannel);
    });

    it('deletes only the removed Channel cache entries', async () => {
        const channel = createChannel({ id: 2, code: 'secondary', token: 'secondary-token' });
        const { service, channelCacheStrategy } = createService({ entity: channel });

        await service.delete(RequestContext.empty(), channel.id);

        expect(channelCacheStrategy.delete).toHaveBeenCalledWith(
            expect.objectContaining({
                id: 2,
                token: 'secondary-token',
            }),
        );
        expect(channelCacheStrategy.clear).not.toHaveBeenCalled();
    });
});

function createService(options: {
    cachedDefault?: Channel;
    cachedByToken?: Channel;
    databaseChannel?: Channel;
    channelCount?: number;
    entity?: Channel;
}) {
    const channelCacheStrategy = {
        getByToken: vi.fn().mockResolvedValue(options.cachedByToken),
        getDefault: vi.fn().mockResolvedValue(options.cachedDefault),
        set: vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
        clear: vi.fn().mockResolvedValue(undefined),
    };
    const repository = {
        findOne: vi.fn().mockResolvedValue(options.databaseChannel),
        count: vi.fn().mockResolvedValue(options.channelCount ?? 2),
        delete: vi.fn().mockResolvedValue(undefined),
    };
    const connection = {
        getEntityOrThrow: vi.fn().mockResolvedValue(options.entity),
        getRepository: vi.fn().mockReturnValue(repository),
    };
    const configService = {
        entityOptions: { channelCacheStrategy },
    } as unknown as ConfigService;
    const eventBus = {
        publish: vi.fn().mockResolvedValue(undefined),
    };
    const service = new ChannelService(
        connection as any,
        configService,
        {} as any,
        {} as any,
        eventBus as any,
        {} as any,
        {} as any,
    );
    return { service, channelCacheStrategy, connection, repository };
}

function createChannel(input?: Partial<Channel>): Channel {
    return new Channel({
        id: 1,
        code: DEFAULT_CHANNEL_CODE,
        token: 'default-token',
        ...input,
    });
}
