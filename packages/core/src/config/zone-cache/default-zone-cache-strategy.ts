import { Json } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { CacheService } from '../../cache/cache.service';
import { Injector } from '../../common/injector';
import { Country } from '../../entity/region/country.entity';
import { Zone } from '../../entity/zone/zone.entity';
import { ConfigService } from '../config.service';

import { ZoneCacheStrategy } from './zone-cache-strategy';

interface LocalCacheEntry {
    zones: Zone[];
    expiresAt: number;
}

const DEFAULT_L2_CACHE_TTL = 5 * 60 * 1000;
const CACHE_KEY = 'vendure-zone-cache:all';
const CACHE_TAG = 'DefaultZoneCacheStrategy';
const DATE_MARKER = '__vendure_zone_cache_date__';

type SerializedDate = { [DATE_MARKER]: string };

/**
 * @description
 * Configuration options for the {@link DefaultZoneCacheStrategy}.
 *
 * @docsCategory cache
 * @docsPage DefaultZoneCacheStrategy
 * @since 3.8.0
 */
export interface DefaultZoneCacheStrategyOptions {
    /**
     * @description
     * The process-local L1 time-to-live. Defaults to `entityOptions.zoneCacheTtl`.
     */
    l1CacheTtl?: number;
    /**
     * @description
     * The shared L2 time-to-live in milliseconds. Defaults to 5 minutes.
     */
    l2CacheTtl?: number;
    /**
     * @description
     * The key used to store the Zone list in the shared cache.
     */
    cacheKey?: string;
}

/**
 * @description
 * Stores the Zone list in a short-lived process-local L1 backed by the configured
 * {@link CacheStrategy} as a shared L2.
 *
 * @docsCategory cache
 * @since 3.8.0
 */
export class DefaultZoneCacheStrategy implements ZoneCacheStrategy {
    protected cacheService: CacheService;
    protected configService: ConfigService;
    private localCache?: LocalCacheEntry;
    private pendingLookup?: Promise<Zone[]>;
    private revision = 0;

    constructor(private options?: DefaultZoneCacheStrategyOptions) {}

    init(injector: Injector) {
        this.cacheService = injector.get(CacheService);
        this.configService = injector.get(ConfigService);
    }

    async get(ctx: RequestContext, load: () => Promise<Zone[]>): Promise<Zone[]> {
        void ctx;
        if (this.localCache) {
            if (Date.now() < this.localCache.expiresAt) {
                return this.localCache.zones;
            }
            this.localCache = undefined;
        }
        if (this.pendingLookup) {
            return this.pendingLookup;
        }
        const revision = this.revision;
        const lookup = this.load(load, revision).finally(() => {
            if (this.pendingLookup === lookup) {
                this.pendingLookup = undefined;
            }
        });
        this.pendingLookup = lookup;
        return lookup;
    }

    async set(ctx: RequestContext, zones: Zone[]): Promise<void> {
        void ctx;
        this.revision++;
        await this.write(zones);
    }

    async delete(ctx: RequestContext): Promise<void> {
        void ctx;
        this.revision++;
        this.localCache = undefined;
        await this.cacheService.delete(this.getCacheKey());
    }

    clear(): Promise<void> {
        this.revision++;
        this.localCache = undefined;
        return this.cacheService.invalidateTags([CACHE_TAG]);
    }

    private async load(load: () => Promise<Zone[]>, revision: number): Promise<Zone[]> {
        const cached = await this.cacheService.get<Json>(this.getCacheKey());
        const zones = cached && Array.isArray(cached) ? this.rehydrate(cached) : await load();
        if (this.revision !== revision) {
            return this.localCache?.zones ?? zones;
        }
        if (cached && Array.isArray(cached)) {
            this.setLocal(zones);
        } else {
            await this.write(zones);
        }
        return zones;
    }

    private async write(zones: Zone[]): Promise<void> {
        this.setLocal(zones);
        await this.cacheService.set(this.getCacheKey(), this.serialize(zones), {
            tags: [CACHE_TAG],
            ttl: this.options?.l2CacheTtl ?? DEFAULT_L2_CACHE_TTL,
        });
    }

    private setLocal(zones: Zone[]): void {
        this.localCache = {
            zones,
            expiresAt: Date.now() + this.getL1CacheTtl(),
        };
    }

    private rehydrate(value: Json[]): Zone[] {
        const deserialized = this.deserialize(value as Json);
        if (!Array.isArray(deserialized)) {
            return [];
        }
        return deserialized.map(item => {
            const zone = new Zone(item as Zone);
            zone.members = (zone.members ?? []).map(member => new Country(member));
            return zone;
        });
    }

    private getL1CacheTtl(): number {
        return this.options?.l1CacheTtl ?? this.configService.entityOptions.zoneCacheTtl;
    }

    private getCacheKey(): string {
        return this.options?.cacheKey ?? CACHE_KEY;
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
