import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { SetCacheKeyOptions } from '../config/system/cache-strategy';

import { CacheService } from './cache.service';

/**
 * @description
 * Configuration for a new {@link Cache} instance.
 *
 * @docsCategory cache
 * @since 3.1.0
 */
export interface CacheConfig {
    /**
     * @description
     * A function which generates a cache key from the given id.
     * This key will be used to store the value in the cache.
     *
     * By convention, the key should be namespaced to avoid conflicts.
     *
     * @example
     * ```ts
     * getKey: id => `MyStrategy:getProductVariantIds:${id}`,
     * ```
     */
    getKey: (id: string | number) => string;
    /**
     * @description
     * Options available when setting the value in the cache.
     */
    options?: SetCacheKeyOptions;
}

/**
 * @description
 * A convenience wrapper around the {@link CacheService} methods which provides a simple
 * API for caching and retrieving data.
 *
 * The advantage of using the `Cache` class rather than directly calling the `CacheService`
 * methods is that it allows you to define a consistent way of generating cache keys and
 * to set default cache options, and takes care of setting the value in cache if it does not
 * already exist.
 *
 * In most cases, using the `Cache` class will result in simpler and more readable code.
 *
 * This class is normally created via the {@link CacheService}.`createCache()` method.
 *
 * @example
 * ```ts
 * const cache = cacheService.createCache({
 *   getKey: id => `ProductVariantIds:${id}`,
 *   options: {
 *     ttl: 1000 * 60 * 60,
 *     tags: ['products'],
 *   },
 * });
 *
 * // This will fetch the value from the cache if it exists, or
 * // fetch it from the ProductService if not, and then cache
 * // using the key 'ProductVariantIds.${id}'.
 * const variantIds = await cache.get(id, async () => {
 *   const variants await ProductService.getVariantsByProductId(ctx, id) ;
 *   // The cached value must be serializable, so we just return the ids
 *   return variants.map(v => v.id);
 * });
 * ```
 *
 * @docsCategory cache
 * @since 3.1.0
 */
export class Cache {
    constructor(
        private config: CacheConfig,
        private cacheService: CacheService,
    ) {}

    /**
     * @description
     * Retrieves the value from the cache if it exists, otherwise calls the `getValueFn` function
     * to get the value, sets it in the cache and returns it.
     */
    async get<T extends JsonCompatible<T>>(
        id: string | number,
        getValueFn: () => T | Promise<T>,
    ): Promise<T> {
        const key = this.config.getKey(id);
        const cachedValue = await this.cacheService.get<T>(key);
        if (cachedValue) {
            return cachedValue;
        }
        const value = await getValueFn();
        await this.cacheService.set(key, value, this.config.options);
        return value;
    }

    /**
     * @description
     * Deletes one or more items from the cache.
     */
    async delete(id: string | number | Array<string | number>): Promise<void> {
        const ids = Array.isArray(id) ? id : [id];
        const keyArgs = ids.map(_id => this.config.getKey(_id));
        await Promise.all(keyArgs.map(key => this.cacheService.delete(key)));
    }

    /**
     * @description
     * Invalidates one or more tags in the cache.
     */
    async invalidateTags(tags: string[]): Promise<void> {
        await this.cacheService.invalidateTags(tags);
    }
}
