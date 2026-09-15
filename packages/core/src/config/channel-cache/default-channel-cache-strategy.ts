import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { Json } from '@vendure/common/lib/shared-types';

import { CacheService } from '../../cache/cache.service';
import { Injector } from '../../common/injector';
import { Channel } from '../../entity/channel/channel.entity';
import { Zone } from '../../entity/zone/zone.entity';
import { ConfigService } from '../config.service';

import { ChannelCacheStrategy } from './channel-cache-strategy';

const DATE_MARKER = '__vendure_channel_cache_date__';

type SerializedDate = {
    [DATE_MARKER]: string;
};

interface LocalCacheEntry {
    channel: Channel;
    expiresAt: number;
}

const DEFAULT_L2_CACHE_TTL = 5 * 60 * 1000;
const DEFAULT_L1_CACHE_SIZE = 10_000;

/**
 * @description
 * Configuration options for the {@link DefaultChannelCacheStrategy}.
 *
 * @docsCategory cache
 * @docsPage DefaultChannelCacheStrategy
 * @since 3.8.0
 */
export interface DefaultChannelCacheStrategyOptions {
    /**
     * @description
     * The time-to-live in milliseconds of the process-local L1 cache. Defaults to
     * `entityOptions.channelCacheTtl`, which is 30 seconds by default.
     */
    l1CacheTtl?: number;
    /**
     * @description
     * Maximum number of keys held in the process-local L1 cache. Defaults to 10,000.
     */
    l1CacheSize?: number;
    /**
     * @description
     * The time-to-live in milliseconds of entries stored in the shared L2 cache.
     * Defaults to 5 minutes.
     */
    l2CacheTtl?: number;
    /**
     * @description
     * Prefix used for keys in the shared L2 cache.
     */
    cachePrefix?: string;
}

/**
 * @description
 * The default {@link ChannelCacheStrategy} uses a short-lived process-local L1 cache backed by
 * the configured {@link CacheStrategy} as a shared L2 cache. This keeps the request hot path in
 * memory while allowing Channel data to be shared via Redis, SQL or another cache backend.
 *
 * @docsCategory cache
 * @since 3.8.0
 */
export class DefaultChannelCacheStrategy implements ChannelCacheStrategy {
    protected cacheService: CacheService;
    protected configService: ConfigService;
    private readonly tags = ['DefaultChannelCacheStrategy'];
    private readonly localCache = new Map<string, LocalCacheEntry>();

    constructor(private options?: DefaultChannelCacheStrategyOptions) {}

    init(injector: Injector) {
        this.cacheService = injector.get(CacheService);
        this.configService = injector.get(ConfigService);
    }

    async set(channel: Channel): Promise<void> {
        this.setLocal(channel);
        const serialized = this.serialize(channel);
        const options = {
            tags: this.tags,
            ttl: this.options?.l2CacheTtl ?? DEFAULT_L2_CACHE_TTL,
        };
        const writes = [this.cacheService.set(this.getTokenCacheKey(channel.token), serialized, options)];
        if (channel.code === DEFAULT_CHANNEL_CODE) {
            writes.push(this.cacheService.set(this.getDefaultCacheKey(), serialized, options));
        }
        await Promise.all(writes);
    }

    async getByToken(token: string): Promise<Channel | undefined> {
        return this.get(this.getTokenCacheKey(token));
    }

    async getDefault(): Promise<Channel | undefined> {
        return this.get(this.getDefaultCacheKey());
    }

    async delete(channel: Channel): Promise<void> {
        this.deleteLocal(channel);
        const deletes = [this.cacheService.delete(this.getTokenCacheKey(channel.token))];
        if (channel.code === DEFAULT_CHANNEL_CODE) {
            deletes.push(this.cacheService.delete(this.getDefaultCacheKey()));
        }
        await Promise.all(deletes);
    }

    clear(): Promise<void> {
        this.localCache.clear();
        return this.cacheService.invalidateTags(this.tags);
    }

    private async get(key: string): Promise<Channel | undefined> {
        const local = this.getLocal(key);
        if (local) {
            return local;
        }
        const cached = await this.cacheService.get<Json>(key);
        if (!cached) {
            return;
        }
        const value = this.deserialize(cached);
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            return;
        }
        const channel = new Channel(value as Channel);
        if (channel.defaultTaxZone) {
            channel.defaultTaxZone = new Zone(channel.defaultTaxZone);
        }
        if (channel.defaultShippingZone) {
            channel.defaultShippingZone = new Zone(channel.defaultShippingZone);
        }
        this.setLocal(channel);
        return channel;
    }

    private getLocal(key: string): Channel | undefined {
        const entry = this.localCache.get(key);
        if (!entry) {
            return;
        }
        if (Date.now() < entry.expiresAt) {
            return entry.channel;
        }
        this.localCache.delete(key);
    }

    private setLocal(channel: Channel): void {
        const entry = {
            channel,
            expiresAt: Date.now() + this.getL1CacheTtl(),
        };
        this.setLocalEntry(this.getTokenCacheKey(channel.token), entry);
        if (channel.code === DEFAULT_CHANNEL_CODE) {
            this.setLocalEntry(this.getDefaultCacheKey(), entry);
        }
    }

    private setLocalEntry(key: string, entry: LocalCacheEntry): void {
        if (this.localCache.has(key)) {
            this.localCache.delete(key);
        }
        const cacheSize = Math.max(1, this.options?.l1CacheSize ?? DEFAULT_L1_CACHE_SIZE);
        while (this.localCache.size >= cacheSize) {
            const oldestKey = this.localCache.keys().next().value;
            if (oldestKey === undefined) {
                break;
            }
            this.localCache.delete(oldestKey);
        }
        this.localCache.set(key, entry);
    }

    private deleteLocal(channel: Channel): void {
        this.localCache.delete(this.getTokenCacheKey(channel.token));
        if (channel.code === DEFAULT_CHANNEL_CODE) {
            this.localCache.delete(this.getDefaultCacheKey());
        }
    }

    private getL1CacheTtl(): number {
        return this.options?.l1CacheTtl ?? this.configService.entityOptions.channelCacheTtl;
    }

    private getTokenCacheKey(token: string): string {
        return `${this.getCachePrefix()}:token:${token}`;
    }

    private getDefaultCacheKey(): string {
        return `${this.getCachePrefix()}:default`;
    }

    private getCachePrefix(): string {
        return this.options?.cachePrefix ?? 'vendure-channel-cache';
    }

    private serialize(value: unknown): Json {
        if (value instanceof Date) {
            return { [DATE_MARKER]: value.toISOString() };
        }
        if (Array.isArray(value)) {
            return value.map(item => this.serialize(item));
        }
        if (value && typeof value === 'object') {
            return Object.entries(value).reduce<Record<string, Json>>((result, [key, item]) => {
                if (item !== undefined && typeof item !== 'function') {
                    result[key] = this.serialize(item);
                }
                return result;
            }, {});
        }
        return value as Json;
    }

    private deserialize(value: Json): unknown {
        if (Array.isArray(value)) {
            return value.map(item => this.deserialize(item));
        }
        if (value && typeof value === 'object') {
            const serializedDate = value as SerializedDate;
            if (Object.keys(value).length === 1 && typeof serializedDate[DATE_MARKER] === 'string') {
                return new Date(serializedDate[DATE_MARKER]);
            }
            return Object.entries(value).reduce<Record<string, unknown>>((result, [key, item]) => {
                result[key] = this.deserialize(item);
                return result;
            }, {});
        }
        return value;
    }
}
