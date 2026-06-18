import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { CacheTtlProvider, DefaultCacheTtlProvider } from '../../cache/cache-ttl-provider';

import { CacheStrategy, SetCacheKeyOptions } from './cache-strategy';

export interface CacheItem<T> {
    value: JsonCompatible<T>;
    expires?: number;
}

/**
 * A {@link CacheStrategy} that stores the cache in memory using a simple
 * JavaScript Map.
 *
 * This is the default strategy that will be used if no other strategy is
 * configured.
 *
 * **Caution** do not use this in a multi-instance deployment because
 * cache invalidation will not propagate to other instances.
 *
 * @since 3.1.0
 */
export class InMemoryCacheStrategy implements CacheStrategy {
    protected cache = new Map<string, CacheItem<any>>();
    protected cacheTags = new Map<string, Set<string>>();
    protected cacheSize = 10_000;
    protected ttlProvider: CacheTtlProvider;

    constructor(config?: { cacheSize?: number; cacheTtlProvider?: CacheTtlProvider }) {
        if (config?.cacheSize) {
            this.cacheSize = config.cacheSize;
        }
        this.ttlProvider = config?.cacheTtlProvider || new DefaultCacheTtlProvider();
    }

    async get<T extends JsonCompatible<T>>(key: string): Promise<T | undefined> {
        const hit = this.cache.get(key);
        if (hit) {
            if (!hit.expires || (hit.expires && this.ttlProvider.getTime() < hit.expires)) {
                return hit.value;
            } else {
                this.cache.delete(key);
            }
        }
    }

    async set<T extends JsonCompatible<T>>(key: string, value: T, options?: SetCacheKeyOptions) {
        if (this.cache.has(key)) {
            // delete key to put the item to the end of
            // the cache, marking it as new again
            this.cache.delete(key);
        } else if (this.cache.size === this.cacheSize) {
            // evict oldest
            const oldest = this.first();
            if (oldest) {
                this.cache.delete(oldest);
            }
        }
        this.cache.set(key, {
            value,
            expires: options?.ttl ? this.ttlProvider.getTime() + options.ttl : undefined,
        });
        if (options?.tags) {
            for (const tag of options.tags) {
                const tagged = this.cacheTags.get(tag) || new Set<string>();
                tagged.add(key);
                this.cacheTags.set(tag, tagged);
            }
        }
    }

    async delete(key: string) {
        this.cache.delete(key);
    }

    async invalidateTags(tags: string[]) {
        for (const tag of tags) {
            const tagged = this.cacheTags.get(tag);
            if (tagged) {
                for (const key of tagged) {
                    this.cache.delete(key);
                }
                this.cacheTags.delete(tag);
            }
        }
    }

    private first() {
        return this.cache.keys().next().value;
    }
}
