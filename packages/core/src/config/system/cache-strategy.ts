import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { InjectableStrategy } from '../../common/types/injectable-strategy';

/**
 * @description
 * Options available when setting the value in the cache.
 *
 * @since 3.1.0
 * @docsCategory cache
 * @docsPage CacheStrategy
 */
export interface SetCacheKeyOptions {
    /**
     * @description
     * The time-to-live for the cache key in milliseconds. This means
     * that after this time period, the key will be considered stale
     * and will no longer be returned from the cache. Omitting
     * this is equivalent to having an infinite ttl.
     */
    ttl?: number;
    /**
     * @description
     * An array of tags which can be used to group cache keys together.
     * This can be useful for bulk deletion of related keys.
     */
    tags?: string[];
}

/**
 * @description
 * The CacheStrategy defines how the underlying shared cache mechanism is implemented.
 *
 * It is used by the {@link CacheService} to take care of storage and retrieval of items
 * from the cache.
 *
 * If you are using the `DefaultCachePlugin` or the `RedisCachePlugin`, you will not need to
 * manually specify a CacheStrategy, as these plugins will automatically configure the
 * appropriate strategy.
 *
 * :::info
 *
 * This is configured via the `systemOptions.cacheStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @since 3.1.0
 * @docsCategory cache
 * @docsPage CacheStrategy
 * @docsWeight 0
 */
export interface CacheStrategy extends InjectableStrategy {
    /**
     * @description
     * Gets an item from the cache, or returns undefined if the key is not found, or the
     * item has expired.
     */
    get<T extends JsonCompatible<T>>(key: string): Promise<T | undefined>;

    /**
     * @description
     * Sets a key-value pair in the cache. The value must be serializable, so cannot contain
     * things like functions, circular data structures, class instances etc.
     *
     * Optionally a "time to live" (ttl) can be specified, which means that the key will
     * be considered stale after that many milliseconds.
     */
    set<T extends JsonCompatible<T>>(key: string, value: T, options?: SetCacheKeyOptions): Promise<void>;

    /**
     * @description
     * Deletes an item from the cache.
     */
    delete(key: string): Promise<void>;

    /**
     * @description
     * Deletes all items from the cache which contain at least one matching tag.
     */
    invalidateTags(tags: string[]): Promise<void>;
}
