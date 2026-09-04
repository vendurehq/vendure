import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { Instrument } from '../common';
import { Injector } from '../common/injector';
import { ConfigService } from '../config/config.service';
import { Logger } from '../config/index';
import { CacheStrategy, SetCacheKeyOptions } from '../config/system/cache-strategy';

import { Cache, CacheConfig } from './cache';

/**
 * @description
 * The CacheService is used to cache data in order to optimize performance.
 *
 * Internally it makes use of the configured {@link CacheStrategy} to persist
 * the cache into a key-value store.
 *
 * @since 3.1.0
 * @docsCategory cache
 */
@Injectable()
@Instrument()
export class CacheService implements OnModuleInit, OnApplicationShutdown {
    protected cacheStrategy: CacheStrategy;
    private cacheStrategyInitialized = false;
    private cacheStrategyInitialization?: Promise<void>;

    constructor(
        private configService: ConfigService,
        private moduleRef: ModuleRef,
    ) {
        this.cacheStrategy = this.configService.systemOptions.cacheStrategy;
    }

    /** @internal */
    async onModuleInit() {
        await this.initializeCacheStrategy();
    }

    /** @internal */
    async onApplicationShutdown() {
        if (this.cacheStrategyInitialized && typeof this.cacheStrategy.destroy === 'function') {
            await this.cacheStrategy.destroy();
        }
        this.cacheStrategyInitialized = false;
        this.cacheStrategyInitialization = undefined;
    }

    /**
     * @description
     * Creates a new {@link Cache} instance with the given configuration.
     *
     * The `Cache` instance provides a convenience wrapper around the `CacheService`
     * methods.
     */
    createCache(config: CacheConfig): Cache {
        return new Cache(config, this);
    }

    /**
     * @description
     * Gets an item from the cache, or returns undefined if the key is not found, or the
     * item has expired.
     */
    async get<T extends JsonCompatible<T>>(key: string): Promise<T | undefined> {
        try {
            if (!this.cacheStrategyInitialized) {
                await this.initializeCacheStrategy();
            }
            const result = await this.cacheStrategy.get(key);
            if (result) {
                Logger.debug(`CacheService hit for key [${key}]`);
            }
            return result as T;
        } catch (e: any) {
            Logger.error(`Could not get key [${key}] from CacheService`, undefined, e.stack);
        }
    }

    /**
     * @description
     * Sets a key-value pair in the cache. The value must be serializable, so cannot contain
     * things like functions, circular data structures, class instances etc.
     *
     * Optionally a "time to live" (ttl) can be specified, which means that the key will
     * be considered stale after that many milliseconds.
     */
    async set<T extends JsonCompatible<T>>(
        key: string,
        value: T,
        options?: SetCacheKeyOptions,
    ): Promise<void> {
        try {
            if (!this.cacheStrategyInitialized) {
                await this.initializeCacheStrategy();
            }
            await this.cacheStrategy.set(key, value, options);
            Logger.debug(`Set key [${key}] in CacheService`);
        } catch (e: any) {
            Logger.error(`Could not set key [${key}] in CacheService`, undefined, e.stack);
        }
    }

    /**
     * @description
     * Deletes an item from the cache.
     */
    async delete(key: string): Promise<void> {
        try {
            if (!this.cacheStrategyInitialized) {
                await this.initializeCacheStrategy();
            }
            await this.cacheStrategy.delete(key);
            Logger.debug(`Deleted key [${key}] from CacheService`);
        } catch (e: any) {
            Logger.error(`Could not delete key [${key}] from CacheService`, undefined, e.stack);
        }
    }

    /**
     * @description
     * Deletes all items from the cache which contain at least one matching tag.
     */
    async invalidateTags(tags: string[]): Promise<void> {
        try {
            if (!this.cacheStrategyInitialized) {
                await this.initializeCacheStrategy();
            }
            await this.cacheStrategy.invalidateTags(tags);
            Logger.debug(`Invalidated tags [${tags.join(', ')}] from CacheService`);
        } catch (e: any) {
            Logger.error(
                `Could not invalidate tags [${tags.join(', ')}] from CacheService`,
                undefined,
                e.stack,
            );
        }
    }

    private initializeCacheStrategy(): Promise<void> {
        if (this.cacheStrategyInitialized) {
            return Promise.resolve();
        }
        if (!this.cacheStrategyInitialization) {
            this.cacheStrategyInitialization = Promise.resolve()
                .then(() => this.cacheStrategy.init?.(new Injector(this.moduleRef)))
                .then(() => {
                    this.cacheStrategyInitialized = true;
                })
                .catch(error => {
                    this.cacheStrategyInitialization = undefined;
                    throw error;
                });
        }
        return this.cacheStrategyInitialization;
    }
}
