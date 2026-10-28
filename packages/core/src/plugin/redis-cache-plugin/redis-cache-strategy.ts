import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { Logger } from '../../config/logger/vendure-logger';
import { CacheStrategy, SetCacheKeyOptions } from '../../config/system/cache-strategy';

import { DEFAULT_NAMESPACE, DEFAULT_TTL, loggerCtx } from './constants';
import { RedisCachePluginInitOptions } from './types';

const INVALIDATION_BATCH_SIZE = 1000;

/**
 * Adds a key to a tag's sorted set, scored by the key's expiry time in ms (Redis server clock).
 * Expired members are pruned, and the tag set expires no earlier than its longest-lived member.
 * KEYS[1] = tag set, ARGV[1] = member, ARGV[2] = ttl in ms.
 */
const ADD_TO_TAG_SCRIPT = `
local time = redis.call('TIME')
local now = time[1] * 1000 + math.floor(time[2] / 1000)
local ttl = tonumber(ARGV[2])
redis.call('ZADD', KEYS[1], now + ttl, ARGV[1])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now)
if redis.call('PTTL', KEYS[1]) < ttl then
    redis.call('PEXPIRE', KEYS[1], ttl)
end
`;

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
                    multi.eval(
                        ADD_TO_TAG_SCRIPT,
                        1,
                        this.tagNamespace(tag),
                        namedspacedKey,
                        Math.round(ttl) * 1000,
                    );
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
        await Promise.all(tags.map(tag => this.invalidateTag(tag)));
    }

    private async invalidateTag(tag: string) {
        const tagKey = this.tagNamespace(tag);
        let members = await this.client.zrange(tagKey, 0, INVALIDATION_BATCH_SIZE - 1);
        while (members.length) {
            await this.deleteMembers(this.client.multi().zrem(tagKey, ...members), members);
            members = await this.client.zrange(tagKey, 0, INVALIDATION_BATCH_SIZE - 1);
        }
        // Tags written by earlier versions are plain SETs under the legacy key name
        const legacyTagKey = this.legacyTagNamespace(tag);
        members = await this.client.srandmember(legacyTagKey, INVALIDATION_BATCH_SIZE);
        while (members.length) {
            await this.deleteMembers(this.client.multi().srem(legacyTagKey, ...members), members);
            members = await this.client.srandmember(legacyTagKey, INVALIDATION_BATCH_SIZE);
        }
    }

    private async deleteMembers(multi: import('ioredis').ChainableCommander, members: string[]) {
        const results = await multi.del(...members).exec();
        const error = results?.find(([err]) => err)?.[0];
        if (error) {
            throw error;
        }
    }

    private namespace(key: string) {
        return `${this.options.namespace ?? DEFAULT_NAMESPACE}:${key}`;
    }

    private tagNamespace(tag: string) {
        return `${this.options.namespace ?? DEFAULT_NAMESPACE}:ztag:${tag}`;
    }

    private legacyTagNamespace(tag: string) {
        return `${this.options.namespace ?? DEFAULT_NAMESPACE}:tag:${tag}`;
    }
}
