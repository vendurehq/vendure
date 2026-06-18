import { JsonCompatible } from '@vendure/common/lib/shared-types';

import { CacheTtlProvider, DefaultCacheTtlProvider } from '../../cache/cache-ttl-provider';
import { Injector } from '../../common/injector';
import { Instrument } from '../../common/instrument-decorator';
import { ConfigService, Logger } from '../../config/index';
import { CacheStrategy, SetCacheKeyOptions } from '../../config/system/cache-strategy';
import { TransactionalConnection } from '../../connection/index';

import { CacheItem } from './cache-item.entity';
import { CacheTag } from './cache-tag.entity';

/**
 * @description
 * A {@link CacheStrategy} that stores cached items in the database. This
 * is the strategy used by the {@link DefaultCachePlugin}.
 *
 * @since 3.1.0
 * @docsCategory cache
 */
@Instrument()
export class SqlCacheStrategy implements CacheStrategy {
    protected cacheSize = 10_000;
    protected ttlProvider: CacheTtlProvider;

    constructor(config?: { cacheSize?: number; cacheTtlProvider?: CacheTtlProvider }) {
        if (config?.cacheSize) {
            this.cacheSize = config.cacheSize;
        }
        this.ttlProvider = config?.cacheTtlProvider || new DefaultCacheTtlProvider();
    }

    protected connection: TransactionalConnection;
    protected configService: ConfigService;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        this.configService = injector.get(ConfigService);
    }

    async get<T extends JsonCompatible<T>>(key: string): Promise<T | undefined> {
        const hit = await this.connection.rawConnection.getRepository(CacheItem).findOne({
            where: {
                key,
            },
        });

        if (hit) {
            if (!hit.expiresAt || (hit.expiresAt && this.ttlProvider.getTime() < hit.expiresAt.getTime())) {
                try {
                    return JSON.parse(hit.value);
                } catch (e: any) {
                    /* */
                }
            } else {
                await this.connection.rawConnection.getRepository(CacheItem).delete({
                    key,
                });
            }
        }
    }

    async set<T extends JsonCompatible<T>>(key: string, value: T, options?: SetCacheKeyOptions) {
        const cacheSize = await this.connection.rawConnection.getRepository(CacheItem).count();
        if (cacheSize >= this.cacheSize) {
            // evict oldest
            const subQuery1 = this.connection.rawConnection
                .getRepository(CacheItem)
                .createQueryBuilder('item')
                .select('item.id', 'item_id')
                .orderBy('item.insertedAt', 'DESC')
                .limit(1000)
                .offset(Math.max(this.cacheSize - 1, 1));
            const subQuery2 = this.connection.rawConnection
                .createQueryBuilder()
                .select('t.item_id')
                .from(`(${subQuery1.getQuery()})`, 't');
            const qb = this.connection.rawConnection
                .getRepository(CacheItem)
                .createQueryBuilder('cache_item')
                .delete()
                .from(CacheItem, 'cache_item')
                .where(`cache_item.id IN (${subQuery2.getQuery()})`);

            try {
                await qb.execute();
            } catch (e: any) {
                Logger.error(`An error occurred when attempting to prune the cache: ${e.message as string}`);
            }
        }
        const item = await this.connection.rawConnection.getRepository(CacheItem).upsert(
            new CacheItem({
                key,
                insertedAt: new Date(),
                value: JSON.stringify(value),
                expiresAt: options?.ttl ? new Date(this.ttlProvider.getTime() + options.ttl) : undefined,
            }),
            ['key'],
        );

        if (options?.tags) {
            for (const tag of options.tags) {
                try {
                    await this.connection.rawConnection.getRepository(CacheTag).upsert(
                        {
                            tag,
                            item: item.identifiers[0],
                        } as any,
                        ['tag', 'itemId'],
                    );
                } catch (e: any) {
                    Logger.error(`Error inserting tag`, e.message);
                }
            }
        }
    }

    async delete(key: string) {
        await this.connection.rawConnection.getRepository(CacheItem).delete({
            key,
        });
    }

    async invalidateTags(tags: string[]) {
        await this.connection.withTransaction(async ctx => {
            const itemIds = await this.connection
                .getRepository(ctx, CacheTag)
                .createQueryBuilder('cache_tag')
                .select('cache_tag.itemId')
                .where('cache_tag.tag IN (:...tags)', { tags })
                .groupBy('cache_tag.itemId')
                .groupBy('cache_tag.id')
                .getMany();

            await this.connection
                .getRepository(ctx, CacheTag)
                .createQueryBuilder('cache_tag')
                .delete()
                .where('cache_tag.tag IN (:...tags)', { tags })
                .execute();

            if (itemIds.length) {
                const ids = itemIds.map(i => i.itemId);
                const batchSize = 1000;

                for (let i = 0; i < itemIds.length; i += batchSize) {
                    const batch = ids.slice(i, batchSize);
                    try {
                        await this.connection.getRepository(ctx, CacheItem).delete(batch);
                    } catch (e: any) {
                        Logger.error(`Error deleting items`, e.message);
                    }
                }
            }
        });
    }
}
