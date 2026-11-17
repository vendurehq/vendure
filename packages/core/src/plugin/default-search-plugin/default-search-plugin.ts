import { OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { SearchReindexResponse } from '@vendure/common/lib/generated-types';
import { ID, Type } from '@vendure/common/lib/shared-types';
import { buffer, debounceTime, delay, filter, map } from 'rxjs/operators';
import { Column, PrimaryColumn } from 'typeorm';

import { Injector } from '../../common';
import { idsAreEqual } from '../../common/utils';
import { EventBus } from '../../event-bus/event-bus';
import { AssetEvent } from '../../event-bus/events/asset-event';
import { ChannelTrackInventoryEvent } from '../../event-bus/events/channel-track-inventory-event';
import { CollectionModificationEvent } from '../../event-bus/events/collection-modification-event';
import { ProductChannelEvent } from '../../event-bus/events/product-channel-event';
import { ProductEvent } from '../../event-bus/events/product-event';
import { ProductVariantChannelEvent } from '../../event-bus/events/product-variant-channel-event';
import { ProductVariantEvent } from '../../event-bus/events/product-variant-event';
import { TaxRateEvent } from '../../event-bus/events/tax-rate-event';
import { JobQueueService } from '../../job-queue/job-queue.service';
import { PluginCommonModule } from '../plugin-common.module';
import { VendurePlugin } from '../vendure-plugin';

import { StockMovementEvent } from '../../event-bus/events/stock-movement-event';
import { stockStatusExtension } from './api/api-extensions';
import { AdminFulltextSearchResolver, ShopFulltextSearchResolver } from './api/fulltext-search.resolver';
import { BUFFER_SEARCH_INDEX_UPDATES, PLUGIN_INIT_OPTIONS } from './constants';
import { SearchIndexItem } from './entities/search-index-item.entity';
import { FulltextSearchService } from './fulltext-search.service';
import { IndexerController } from './indexer/indexer.controller';
import { SearchIndexService } from './indexer/search-index.service';
import { SearchJobBufferService } from './search-job-buffer/search-job-buffer.service';
import { DefaultSearchPluginInitOptions } from './types';

export interface DefaultSearchReindexResponse extends SearchReindexResponse {
    timeTaken: number;
    indexedItemCount: number;
}

/**
 * @description
 * The DefaultSearchPlugin provides a full-text Product search based on the full-text searching capabilities of the
 * underlying database.
 *
 * The DefaultSearchPlugin is bundled with the `\@vendure/core` package. If you are not using an alternative search
 * plugin, then make sure this one is used, otherwise you will not be able to search products via the
 * [`search` query](/reference/graphql-api/shop/queries#search).
 *
 * :::caution
 * Note that the quality of the fulltext search capabilities varies depending on the underlying database being used. For example,
 * the MySQL & Postgres implementations will typically yield better results than the SQLite implementation.
 * :::
 *
 *
 * @example
 * ```ts
 * import { DefaultSearchPlugin, VendureConfig } from '\@vendure/core';
 *
 * export const config: VendureConfig = {
 *   // Add an instance of the plugin to the plugins array
 *   plugins: [
 *     DefaultSearchPlugin.init({
 *       bufferUpdates: true,
 *     }),
 *   ],
 * };
 * ```
 *
 * @docsCategory DefaultSearchPlugin
 */
@VendurePlugin({
    imports: [PluginCommonModule],
    configuration: config => {
        DefaultSearchPlugin.addIndexColumnsToEntity();
        return config;
    },
    providers: [
        FulltextSearchService,
        SearchIndexService,
        IndexerController,
        SearchJobBufferService,
        { provide: PLUGIN_INIT_OPTIONS, useFactory: () => DefaultSearchPlugin.options },
        {
            provide: BUFFER_SEARCH_INDEX_UPDATES,
            useFactory: () => DefaultSearchPlugin.options.bufferUpdates === true,
        },
    ],
    adminApiExtensions: {
        schema: () =>
            DefaultSearchPlugin.options.indexStockStatus === true ? stockStatusExtension : undefined,
        resolvers: [AdminFulltextSearchResolver],
    },
    shopApiExtensions: {
        schema: () =>
            DefaultSearchPlugin.options.indexStockStatus === true ? stockStatusExtension : undefined,
        resolvers: [ShopFulltextSearchResolver],
    },
    entities: [SearchIndexItem],
    compatibility: '>0.0.0',
})
export class DefaultSearchPlugin implements OnApplicationBootstrap, OnApplicationShutdown {
    static options: DefaultSearchPluginInitOptions = DefaultSearchPlugin.withDefaults({});
    private static indexColumnsAdded = false;

    /** @internal */
    constructor(
        private eventBus: EventBus,
        private searchIndexService: SearchIndexService,
        private jobQueueService: JobQueueService,
        private moduleRef: ModuleRef,
    ) {}

    static init(options: DefaultSearchPluginInitOptions): Type<DefaultSearchPlugin> {
        this.options = this.withDefaults(options);
        return DefaultSearchPlugin;
    }

    private static withDefaults(options: DefaultSearchPluginInitOptions): DefaultSearchPluginInitOptions {
        return {
            ...options,
            indexStockStatus: options.indexStockStatus ?? true,
            indexCurrencyCode: options.indexCurrencyCode ?? true,
        };
    }

    /** @internal */
    async onApplicationBootstrap() {
        this.eventBus.ofType(ProductEvent).subscribe(event => {
            if (event.type === 'deleted') {
                return this.searchIndexService.deleteProduct(event.ctx, event.entity);
            } else {
                return this.searchIndexService.updateProduct(event.ctx, event.entity);
            }
        });
        this.eventBus.ofType(ProductVariantEvent).subscribe(event => {
            if (event.type === 'deleted') {
                return this.searchIndexService.deleteVariant(event.ctx, event.entity);
            } else {
                return this.searchIndexService.updateVariants(event.ctx, event.entity);
            }
        });
        this.eventBus.ofType(AssetEvent).subscribe(event => {
            if (event.type === 'updated') {
                return this.searchIndexService.updateAsset(event.ctx, event.entity);
            }
            if (event.type === 'deleted') {
                return this.searchIndexService.deleteAsset(event.ctx, event.entity);
            }
        });
        this.eventBus.ofType(ProductChannelEvent).subscribe(event => {
            if (event.type === 'assigned') {
                return this.searchIndexService.assignProductToChannel(
                    event.ctx,
                    event.product.id,
                    event.channelId,
                );
            } else {
                return this.searchIndexService.removeProductFromChannel(
                    event.ctx,
                    event.product.id,
                    event.channelId,
                );
            }
        });
        this.eventBus.ofType(ProductVariantChannelEvent).subscribe(event => {
            if (event.type === 'assigned') {
                return this.searchIndexService.assignVariantToChannel(
                    event.ctx,
                    event.productVariant.id,
                    event.channelId,
                );
            } else {
                return this.searchIndexService.removeVariantFromChannel(
                    event.ctx,
                    event.productVariant.id,
                    event.channelId,
                );
            }
        });

        this.eventBus.ofType(StockMovementEvent).subscribe(event => {
            return this.searchIndexService.updateVariants(
                event.ctx,
                event.stockMovements.map(m => m.productVariant),
            );
        });

        // TODO: Remove this buffering logic because because we have dedicated buffering based on #1137
        const collectionModification$ = this.eventBus.ofType(CollectionModificationEvent);
        const closingNotifier$ = collectionModification$.pipe(debounceTime(50));
        collectionModification$
            .pipe(
                buffer(closingNotifier$),
                filter(events => 0 < events.length),
                map(events => ({
                    ctx: events[0].ctx,
                    ids: events.reduce((ids, e) => [...ids, ...e.productVariantIds], [] as ID[]),
                })),
                filter(e => 0 < e.ids.length),
            )
            .subscribe(events => {
                return this.searchIndexService.updateVariantsById(events.ctx, events.ids);
            });

        this.eventBus
            .ofType(TaxRateEvent)
            // The delay prevents a "TransactionNotStartedError" (in SQLite/sqljs) by allowing any existing
            // transactions to complete before a new job is added to the queue (assuming the SQL-based
            // JobQueueStrategy).
            // TODO: should be able to remove owing to f0fd6625
            .pipe(
                filter(event => event.type !== 'deleted'),
                delay(1),
            )
            .subscribe(event => {
                const defaultTaxZone = event.ctx.channel.defaultTaxZone;
                if (defaultTaxZone && idsAreEqual(defaultTaxZone.id, event.entity.zone.id)) {
                    return this.searchIndexService.reindex(event.ctx);
                }
            });

        // A Channel's trackInventory decides whether its INHERIT variants are in stock.
        this.eventBus
            .ofType(ChannelTrackInventoryEvent)
            // See the TaxRateEvent subscription above.
            .pipe(delay(1))
            .subscribe(event => this.searchIndexService.reindex(event.ctx.copy(event.channel)));

        await this.initSearchStrategy();
    }

    /** @internal */
    async onApplicationShutdown(signal?: string) {
        await this.destroySearchStrategy();
    }

    private async initSearchStrategy(): Promise<void> {
        const injector = new Injector(this.moduleRef);
        const searchService = injector.get(FulltextSearchService);
        if (typeof searchService.searchStrategy.init === 'function') {
            await searchService.searchStrategy.init(injector);
        }
    }

    private async destroySearchStrategy(): Promise<void> {
        const injector = new Injector(this.moduleRef);
        const searchService = injector.get(FulltextSearchService);
        if (typeof searchService.searchStrategy.destroy === 'function') {
            await searchService.searchStrategy.destroy();
        }
    }

    /**
     * Adds the columns needed by the `indexStockStatus` and `indexCurrencyCode` options to the
     * SearchIndexItem entity, unless they are turned off. Run from the `configuration` hook rather
     * than `init()`, so that a plugin used without calling `init()` gets the columns too.
     *
     * @internal
     */
    static addIndexColumnsToEntity() {
        if (this.indexColumnsAdded) {
            return;
        }
        this.indexColumnsAdded = true;
        const instance = new SearchIndexItem();
        if (this.options.indexStockStatus === true) {
            Column({ type: 'boolean', default: true })(instance, 'inStock');
            Column({ type: 'boolean', default: true })(instance, 'productInStock');
        }
        if (this.options.indexCurrencyCode === true) {
            PrimaryColumn({ type: 'varchar' })(instance, 'currencyCode');
        }
    }
}
