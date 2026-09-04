import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Channel } from '../../entity/channel/channel.entity';

/**
 * @description
 * Defines how individual Channels are cached. Channels are accessed on virtually every request,
 * so caching them avoids repeated database queries while allowing the cache storage to be shared
 * between multiple server and worker instances.
 *
 * The default implementation is the {@link DefaultChannelCacheStrategy}, which delegates to the
 * configured {@link CacheStrategy}.
 *
 * This is configured via the `entityOptions.channelCacheStrategy` property of your VendureConfig.
 *
 * @docsCategory cache
 * @docsPage ChannelCacheStrategy
 * @docsWeight 0
 * @since 3.8.0
 */
export interface ChannelCacheStrategy extends InjectableStrategy {
    /**
     * @description
     * Stores a Channel in the cache.
     */
    set(channel: Channel): void | Promise<void>;

    /**
     * @description
     * Returns the Channel with the given token, or `undefined` when it is not cached.
     */
    getByToken(token: string): Channel | undefined | Promise<Channel | undefined>;

    /**
     * @description
     * Returns the default Channel, or `undefined` when it is not cached.
     */
    getDefault(): Channel | undefined | Promise<Channel | undefined>;

    /**
     * @description
     * Deletes all cache entries belonging to the given Channel.
     */
    delete(channel: Channel): void | Promise<void>;

    /**
     * @description
     * Clears every cached Channel.
     */
    clear(): void | Promise<void>;
}
