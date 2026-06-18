import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { Logger } from '../../config/logger/vendure-logger';
import { CacheStrategy, SetCacheKeyOptions } from '../../config/system/cache-strategy';

import { DEFAULT_NAMESPACE, DEFAULT_TTL, loggerCtx } from './constants';
import { RedisCachePluginInitOptions } from './types';

/**
 * @description
 * A {@link CacheStrategy} which stores cached items in a Redis instance.
 * This is a high-performance cache strategy which is suitable for production use.
 *
 * Note: To use this strategy, you need to manually install the `ioredis` package:
 *
 * ```shell
 * npm install ioredis@^5.3.2
 * ```
 *
 * @docsCategory cache
 * @since 3.1.0
 */
export class RedisCacheStrategy implements CacheStrategy {
    private client: import('ioredis').Redis;

    constructor(private options: RedisCachePluginInitOptions) {}

    async init() {
        const IORedis = await import('ioredis').then(m => m.default);
        this.client = new IORedis.Redis(this.options.redisOptions ?? {});
        this.client.on('error', err => Logger.error(err.message, loggerCtx, err.stack));
    }
    async destroy() {
        await this.client.quit();
    }

    async get<T extends JsonCompatible<T>>(key: string): Promise<T | undefined> {
        try {
            const retrieved = await this.client.get(this.namespace(key));
            if (retrieved) {
                try {
                    return JSON.parse(retrieved);
                } catch (e: any) {
                    Logger.error(`Could not parse cache item ${key}: ${e.message as string}`, loggerCtx);
                }
            }
        } catch (e: any) {
            Logger.error(`Could not get cache item ${key}: ${e.message as string}`, loggerCtx);
        }
    }
    async set<T extends JsonCompatible<T>>(
        key: string,
        value: T,
        options?: SetCacheKeyOptions,
    ): Promise<void> {
        try {
            const multi = this.client.multi();
            const ttl = options?.ttl ? options.ttl / 1000 : DEFAULT_TTL;
            const namedspacedKey = this.namespace(key);
            const serializedValue = JSON.stringify(value);
            if (this.options.maxItemSizeInBytes) {
                if (Buffer.byteLength(serializedValue) > this.options.maxItemSizeInBytes) {
                    Logger.error(
                        `Could not set cache item ${key}: item size of ${Buffer.byteLength(
                            serializedValue,
                        )} bytes exceeds maxItemSizeInBytes of ${this.options.maxItemSizeInBytes} bytes`,
                        loggerCtx,
                    );
                    return;
                }
            }
            if (Math.round(ttl) <= 0) {
                Logger.error(
                    `Could not set cache item ${key}: TTL must be greater than 0 seconds`,
                    loggerCtx,
                );
                return;
            }
            multi.set(namedspacedKey, JSON.stringify(value), 'EX', Math.round(ttl));
            if (options?.tags) {
                for (const tag of options.tags) {
                    multi.sadd(this.tagNamespace(tag), namedspacedKey);
                }
            }
            const results = await multi.exec();
            const resultWithError = results?.find(([err, _]) => err);
            if (resultWithError) {
                throw resultWithError[0];
            }
        } catch (e: any) {
            Logger.error(`Could not set cache item ${key}: ${e.message as string}`, loggerCtx);
        }
    }

    async delete(key: string): Promise<void> {
        try {
            await this.client.del(this.namespace(key));
        } catch (e: any) {
            Logger.error(`Could not delete cache item ${key}: ${e.message as string}`, loggerCtx);
        }
    }

    async invalidateTags(tags: string[]): Promise<void> {
        try {
            const keys = [
                ...(await Promise.all(tags.map(tag => this.client.smembers(this.tagNamespace(tag))))),
            ];
            const pipeline = this.client.pipeline();

            keys.forEach(key => {
                pipeline.del(key);
            });

            tags.forEach(tag => {
                const namespacedTag = this.tagNamespace(tag);
                pipeline.del(namespacedTag);
            });

            await pipeline.exec();
        } catch (err) {
            return Promise.reject(err);
        }
    }

    private namespace(key: string) {
        return `${this.options.namespace ?? DEFAULT_NAMESPACE}:${key}`;
    }

    private tagNamespace(tag: string) {
        return `${this.options.namespace ?? DEFAULT_NAMESPACE}:tag:${tag}`;
    }
}
