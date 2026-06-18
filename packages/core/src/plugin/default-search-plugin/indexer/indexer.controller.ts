import { Inject, Injectable } from '@nestjs/common';
import { JobState, LanguageCode } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { unique } from '@vendure/common/lib/unique';
import { Observable } from 'rxjs';
import { Equal, FindManyOptions, FindOptionsWhere, In, IsNull } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { AsyncQueue } from '../../../common/async-queue';
import { Translatable, Translation } from '../../../common/types/locale-types';
import { asyncObservable, idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { Logger } from '../../../config/logger/vendure-logger';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Channel } from '../../../entity/channel/channel.entity';
import { FacetValue } from '../../../entity/facet-value/facet-value.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { Product } from '../../../entity/product/product.entity';
import { Job } from '../../../job-queue/job';
import { EntityHydrator } from '../../../service/helpers/entity-hydrator/entity-hydrator.service';
import { ProductPriceApplicator } from '../../../service/helpers/product-price-applicator/product-price-applicator';
import { ProductVariantService } from '../../../service/services/product-variant.service';
import { PLUGIN_INIT_OPTIONS } from '../constants';
import { SearchIndexItem } from '../entities/search-index-item.entity';
import {
    DefaultSearchPluginInitOptions,
    ProductChannelMessageData,
    ReindexMessageResponse,
    UpdateAssetMessageData,
    UpdateIndexQueueJobData,
    UpdateProductMessageData,
    UpdateVariantMessageData,
    UpdateVariantsByIdJobData,
    VariantChannelMessageData,
} from '../types';

import { dedupeSearchIndexItems } from './index-item-utils';
import { MutableRequestContext } from './mutable-request-context';

export const BATCH_SIZE = 1000;
export const productRelations = [
    'translations',
    'featuredAsset',
    'facetValues',
    'facetValues.facet',
    'variants',
    'channels',
];
export const variantRelations = [
    'translations',
    'taxCategory',
    'featuredAsset',
    'productVariantPrices',
    'channels',
    'channels.defaultTaxZone',
    'facetValues',
    'facetValues.facet',
    'product',
    'product.translations',
    'product.channels',
    'product.facetValues',
    'product.facetValues.facet',
    'collections',
    'collections.translations',
];
export const workerLoggerCtx = 'DefaultSearchPlugin Worker';

@Injectable()
export class IndexerController {
    private queue = new AsyncQueue('search-index');

    constructor(
        private connection: TransactionalConnection,
        private entityHydrator: EntityHydrator,
        private productPriceApplicator: ProductPriceApplicator,
        private configService: ConfigService,
        private requestContextCache: RequestContextCacheService,
        private productVariantService: ProductVariantService,
        @Inject(PLUGIN_INIT_OPTIONS) private options: DefaultSearchPluginInitOptions,
    ) {}

    reindex(job: Job<UpdateIndexQueueJobData>): Observable<ReindexMessageResponse> {
        const { ctx: rawContext } = job.data;
        const ctx = MutableRequestContext.deserialize(rawContext);
        return asyncObservable(async observer => {
            const timeStart = Date.now();
            const channel = ctx.channel ?? (await this.loadChannel(ctx, ctx.channelId));
            const { count } = await this.getSearchIndexQueryBuilder(ctx, { channels: [channel] });
            Logger.verbose(`Reindexing ${count} variants for channel ${ctx.channel.code}`, workerLoggerCtx);
            const batches = Math.ceil(count / BATCH_SIZE);

            await this.connection.getRepository(ctx, SearchIndexItem).delete({ channelId: ctx.channelId });
            Logger.verbose('Deleted existing index items', workerLoggerCtx);

            for (let i = 0; i < batches; i++) {
                if (job.state === JobState.CANCELLED) {
                    throw new Error('reindex job was cancelled');
                }
                Logger.verbose(`Processing batch ${i + 1} of ${batches}`, workerLoggerCtx);
                const { variants } = await this.getSearchIndexQueryBuilder(ctx, {
                    channels: [channel],
                    take: BATCH_SIZE,
                    skip: i * BATCH_SIZE,
                });
                await this.saveVariants(ctx, variants);
                observer.next({
                    total: count,
                    completed: Math.min((i + 1) * BATCH_SIZE, count),
                    duration: +new Date() - timeStart,
                });
            }
            Logger.verbose('Completed reindexing', workerLoggerCtx);

            return {
                total: count,
                completed: count,
                duration: +new Date() - timeStart,
            };
        });
    }

    updateVariantsById(job: Job<UpdateVariantsByIdJobData>): Observable<ReindexMessageResponse> {
        const { ctx: rawContext, ids } = job.data;
        const ctx = MutableRequestContext.deserialize(rawContext);

        return asyncObservable(async observer => {
            const timeStart = Date.now();
            if (ids.length) {
                const batches = Math.ceil(ids.length / BATCH_SIZE);
                Logger.verbose(`Updating ${ids.length} variants...`);

                for (let i = 0; i < batches; i++) {
                    if (job.state === JobState.CANCELLED) {
                        throw new Error('updateVariantsById job was cancelled');
                    }
                    const begin = i * BATCH_SIZE;
                    const end = begin + BATCH_SIZE;
                    Logger.verbose(`Updating ids from index ${begin} to ${end}`);
                    const batchIds = ids.slice(begin, end);
                    const { variants: batch } = await this.getSearchIndexQueryBuilder(ctx, {
                        channels: await this.getAllChannels(ctx),
                        productVariantIds: batchIds,
                    });

                    await this.saveVariants(ctx, batch);
                    observer.next({
                        total: ids.length,
                        completed: Math.min((i + 1) * BATCH_SIZE, ids.length),
                        duration: +new Date() - timeStart,
                    });
                }
            }
            Logger.verbose('Completed reindexing!');
            return {
                total: ids.length,
                completed: ids.length,
                duration: +new Date() - timeStart,
            };
        });
    }

    async updateProduct(data: UpdateProductMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(data.ctx);
        return this.updateProductInChannel(ctx, data.productId, ctx.channelId);
    }

    async updateVariants(data: UpdateVariantMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(data.ctx);
        return this.updateVariantsInChannel(ctx, data.variantIds, ctx.channelId);
    }

    async deleteProduct(data: UpdateProductMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(data.ctx);
        return this.deleteProductInChannel(
            ctx,
            data.productId,
            (await this.getAllChannels(ctx)).map(x => x.id),
        );
    }

    async deleteVariant(data: UpdateVariantMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(data.ctx);
        const variants = await this.connection.getRepository(ctx, ProductVariant).find({
            where: { id: In(data.variantIds) },
        });
        if (variants.length) {
            await this.removeSearchIndexItems(
                ctx,
                variants.map(v => v.id),
                (await this.getAllChannels(ctx)).map(c => c.id),
            );
        }
        return true;
    }

    async assignProductToChannel(data: ProductChannelMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(data.ctx);
        return this.updateProductInChannel(ctx, data.productId, data.channelId);
    }

    async removeProductFromChannel(data: ProductChannelMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(data.ctx);
        return this.deleteProductInChannel(ctx, data.productId, [data.channelId]);
    }

    async assignVariantToChannel(data: VariantChannelMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(data.ctx);
        return this.updateVariantsInChannel(ctx, [data.productVariantId], data.channelId);
    }

    async removeVariantFromChannel(data: VariantChannelMessageData): Promise<boolean> {
        const ctx = MutableRequestContext.deserialize(data.ctx);
        const variant = await this.connection
            .getRepository(ctx, ProductVariant)
            .findOne({ where: { id: data.productVariantId } });
        await this.removeSearchIndexItems(ctx, [data.productVariantId], [data.channelId]);
        return true;
    }

    async updateAsset(data: UpdateAssetMessageData): Promise<boolean> {
        const id = data.asset.id;
        const ctx = MutableRequestContext.deserialize(data.ctx);

        function getFocalPoint(point?: { x: number; y: number }) {
            return point && point.x && point.y ? point : null;
        }

        const focalPoint = getFocalPoint(data.asset.focalPoint);
        await this.connection
            .getRepository(ctx, SearchIndexItem)
            .update({ productAssetId: id }, { productPreviewFocalPoint: focalPoint });
        await this.connection
            .getRepository(ctx, SearchIndexItem)
            .update({ productVariantAssetId: id }, { productVariantPreviewFocalPoint: focalPoint });
        return true;
    }

    async deleteAsset(data: UpdateAssetMessageData): Promise<boolean> {
        const id = data.asset.id;
        const ctx = MutableRequestContext.deserialize(data.ctx);

        await this.connection
            .getRepository(ctx, SearchIndexItem)
            .update({ productAssetId: id }, { productAssetId: null });
        await this.connection
            .getRepository(ctx, SearchIndexItem)
            .update({ productVariantAssetId: id }, { productVariantAssetId: null });
        return true;
    }

    private async updateProductInChannel(
        ctx: MutableRequestContext,
        productId: ID,
        channelId: ID,
    ): Promise<boolean> {
        const channel = await this.loadChannel(ctx, channelId);
        ctx.setChannel(channel);
        const product = await this.getProductInChannelQueryBuilder(ctx, productId, channel);

        if (product) {
            const affectedChannels = await this.getAllChannels(ctx, {
                where: {
                    availableLanguageCodes: In(product.translations.map(t => t.languageCode)),
                },
            });
            const { variants: updatedVariants } = await this.getSearchIndexQueryBuilder(ctx, {
                channels: unique(affectedChannels.concat(channel)),
                productId,
            });
            if (updatedVariants.length === 0) {
                const clone = new Product({ id: product.id });
                await this.entityHydrator.hydrate(ctx, clone, { relations: ['translations' as never] });
                product.translations = clone.translations;
                await this.saveSyntheticVariant(ctx, product);
            } else {
                if (product.enabled === false) {
                    updatedVariants.forEach(v => (v.enabled = false));
                }
                const variantsInCurrentChannel = updatedVariants.filter(
                    v => !!v.channels.find(c => idsAreEqual(c.id, ctx.channelId)),
                );

                Logger.verbose(`Updating ${variantsInCurrentChannel.length} variants`, workerLoggerCtx);
                if (variantsInCurrentChannel.length) {
                    await this.saveVariants(ctx, variantsInCurrentChannel);
                }
            }
        }
        return true;
    }

    private async updateVariantsInChannel(
        ctx: MutableRequestContext,
        variantIds: ID[],
        channelId: ID,
    ): Promise<boolean> {
        const channel = await this.loadChannel(ctx, channelId);
        ctx.setChannel(channel);
        const { variants } = await this.getSearchIndexQueryBuilder(ctx, {
            channels: [channel],
            productVariantIds: variantIds,
        });

        if (variants) {
            Logger.verbose(`Updating ${variants.length} variants`, workerLoggerCtx);
            await this.saveVariants(ctx, variants);
        }
        return true;
    }

    private async deleteProductInChannel(
        ctx: RequestContext,
        productId: ID,
        channelIds: ID[],
    ): Promise<boolean> {
        const channels = await Promise.all(channelIds.map(channelId => this.loadChannel(ctx, channelId)));
        const product = await this.getProductInChannelQueryBuilder(ctx, productId, ...channels);

        if (product) {
            const removedVariantIds = product.variants.map(v => v.id);
            if (removedVariantIds.length) {
                await this.removeSearchIndexItems(ctx, removedVariantIds, channelIds);
            }
        }
        return true;
    }

    private async loadChannel(ctx: RequestContext, channelId: ID): Promise<Channel> {
        return await this.connection.getRepository(ctx, Channel).findOneOrFail({ where: { id: channelId } });
    }

    private async getAllChannels(
        ctx: RequestContext,
        options?: FindManyOptions<Channel> | undefined,
    ): Promise<Channel[]> {
        return await this.connection
            .getRepository(ctx, Channel)
            .find({ ...options, relationLoadStrategy: 'query' });
    }

    private async getSearchIndexQueryBuilder(
        ctx: RequestContext,
        options?: {
            productId?: ID;
            productVariantIds?: ID[];
            channels?: Channel[];
            take?: number;
            skip?: number;
        },
    ): Promise<{ variants: ProductVariant[]; count: number }> {
        const {
            productId = undefined,
            productVariantIds = undefined,
            channels = [],
            take = 50,
            skip = 0,
        } = options ?? {};
        const where: FindOptionsWhere<ProductVariant> = {
            deletedAt: IsNull(),
            product: {
                deletedAt: IsNull(),
            },
        };
        if (productId) {
            where.productId = productId;
        }
        if (productVariantIds && productVariantIds.length > 0) {
            where.id = In(productVariantIds);
        }
        where.channels = { id: In(channels.map(c => c.id)) };
        const [variants, count] = await this.connection.getRepository(ctx, ProductVariant).findAndCount({
            loadEagerRelations: false,
            relations: variantRelations,
            where,
            take,
            skip,
            // Ordering makes the take/skip pagination deterministic, otherwise variants
            // can be repeated or skipped across batches when the catalog is concurrently
            // modified during a reindex.
            order: { id: 'ASC' },
            relationLoadStrategy: 'query',
        });
        return { variants, count };
    }

    private async getProductInChannelQueryBuilder(
        ctx: RequestContext,
        productId: ID,
        ...channels: Channel[]
    ): Promise<Product | undefined> {
        const channelLanguages = unique(
            channels.flatMap(c => c.availableLanguageCodes).concat(this.configService.defaultLanguageCode),
        );

        const product = await this.connection.getRepository(ctx, Product).findOne({
            loadEagerRelations: false,
            relations: productRelations,
            relationLoadStrategy: 'query',
            where: { id: Equal(productId), channels: { id: In(channels.map(x => x.id)) } },
        });
        return product ?? undefined;
    }

    private async saveVariants(ctx: MutableRequestContext, variants: ProductVariant[]) {
        const items: SearchIndexItem[] = [];

        await this.removeSyntheticVariants(ctx, variants);
        const productMap = new Map<ID, Product>();

        const originalChannel = ctx.channel;
        for (const variant of variants) {
            ctx.setChannel(originalChannel);
            let product = productMap.get(variant.productId);
            if (!product) {
                product = await this.getProductInChannelQueryBuilder(ctx, variant.productId, ctx.channel);
                if (!product) {
                    throw new Error('Product not found for variant!');
                }
                productMap.set(variant.productId, product);
            }
            const availableLanguageCodes = unique(ctx.channel.availableLanguageCodes);
            for (const languageCode of availableLanguageCodes) {
                const productTranslation = this.getTranslation(product, languageCode);
                const variantTranslation = this.getTranslation(variant, languageCode);
                const collectionTranslations = variant.collections.map(c =>
                    this.getTranslation(c, languageCode),
                );
                let channelIds = variant.channels.map(x => x.id);
                const clone = new ProductVariant({ id: variant.id });
                await this.entityHydrator.hydrate(ctx, clone, {
                    relations: ['channels', 'channels.defaultTaxZone'],
                });
                channelIds.push(
                    ...clone.channels
                        .filter(x => x.availableLanguageCodes.includes(languageCode))
                        .map(x => x.id),
                );
                channelIds = unique(channelIds);

                for (const channel of variant.channels) {
                    const availableCurrencyCodes = this.options.indexCurrencyCode
                        ? unique(channel.availableCurrencyCodes)
                        : [channel.defaultCurrencyCode];

                    for (const currencyCode of availableCurrencyCodes) {
                        const ch = new Channel({ ...channel, defaultCurrencyCode: currencyCode });
                        ctx.setChannel(ch);

                        await this.productPriceApplicator.applyChannelPriceAndTax(variant, ctx);
                        const item = new SearchIndexItem({
                            channelId: ctx.channelId,
                            languageCode,
                            currencyCode,
                            productVariantId: variant.id,
                            price: variant.price,
                            priceWithTax: variant.priceWithTax,
                            sku: variant.sku,
                            enabled: product.enabled === false ? false : variant.enabled,
                            slug: productTranslation?.slug ?? '',
                            productId: product.id,
                            productName: productTranslation?.name ?? '',
                            description: this.constrainDescription(productTranslation?.description ?? ''),
                            productVariantName: variantTranslation?.name ?? '',
                            productAssetId: product.featuredAsset ? product.featuredAsset.id : null,
                            productPreviewFocalPoint: product.featuredAsset
                                ? product.featuredAsset.focalPoint
                                : null,
                            productVariantPreviewFocalPoint: variant.featuredAsset
                                ? variant.featuredAsset.focalPoint
                                : null,
                            productVariantAssetId: variant.featuredAsset ? variant.featuredAsset.id : null,
                            productPreview: product.featuredAsset ? product.featuredAsset.preview : '',
                            productVariantPreview: variant.featuredAsset ? variant.featuredAsset.preview : '',
                            channelIds: channelIds.map(x => x.toString()),
                            facetIds: this.getFacetIds(variant, product),
                            facetValueIds: this.getFacetValueIds(variant, product),
                            collectionIds: variant.collections.map(c => c.id.toString()),
                            collectionSlugs:
                                collectionTranslations.map(c => c?.slug).filter(notNullOrUndefined) ?? [],
                        });
                        if (this.options.indexStockStatus) {
                            item.inStock =
                                0 < (await this.productVariantService.getSaleableStockLevel(ctx, variant));
                            const productInStock = await this.requestContextCache.get(
                                ctx,
                                `productVariantsStock-${variant.productId}-${ctx.channelId}`,
                                () =>
                                    this.connection
                                        .getRepository(ctx, ProductVariant)
                                        .find({
                                            loadEagerRelations: false,
                                            where: {
                                                productId: variant.productId,
                                                deletedAt: IsNull(),
                                            },
                                        })
                                        .then(_variants =>
                                            Promise.all(
                                                _variants.map(v =>
                                                    this.productVariantService.getSaleableStockLevel(ctx, v),
                                                ),
                                            ),
                                        )
                                        .then(stockLevels => stockLevels.some(stockLevel => 0 < stockLevel)),
                            );
                            item.productInStock = productInStock;
                        }
                        items.push(item);
                    }
                }
            }
        }
        ctx.setChannel(originalChannel);

        await this.queue.push(() => this.upsertSearchIndexItems(ctx, items));
    }

    /**
     * If a Product has no variants, we create a synthetic variant for the purposes
     * of making that product visible via the search query.
     */
    private async saveSyntheticVariant(ctx: RequestContext, product: Product) {
        const productTranslation = this.getTranslation(product, ctx.languageCode);
        const item = new SearchIndexItem({
            channelId: ctx.channelId,
            currencyCode: ctx.currencyCode,
            languageCode: ctx.languageCode,
            productVariantId: 0,
            price: 0,
            priceWithTax: 0,
            sku: '',
            enabled: false,
            slug: productTranslation.slug,
            productId: product.id,
            productName: productTranslation.name,
            description: this.constrainDescription(productTranslation.description),
            productVariantName: productTranslation.name,
            productAssetId: product.featuredAsset?.id ?? null,
            productPreviewFocalPoint: product.featuredAsset?.focalPoint ?? null,
            productVariantPreviewFocalPoint: null,
            productVariantAssetId: null,
            productPreview: product.featuredAsset?.preview ?? '',
            productVariantPreview: '',
            channelIds: [ctx.channelId.toString()],
            facetIds: product.facetValues?.map(fv => fv.facet.id.toString()) ?? [],
            facetValueIds: product.facetValues?.map(fv => fv.id.toString()) ?? [],
            collectionIds: [],
            collectionSlugs: [],
        });
        await this.queue.push(() => this.upsertSearchIndexItems(ctx, [item]));
    }

    /**
     * Persists the given items with an atomic upsert on the composite primary key, so that
     * concurrent index writes (e.g. a reindex racing an update job in another worker process,
     * or synthetic variant-less product rows, which all share `productVariantId: 0`) converge
     * on the latest state rather than throwing a duplicate-key error, as the non-atomic
     * check-then-insert of `save()` does.
     * See https://github.com/vendurehq/vendure/issues/4805
     */
    private async upsertSearchIndexItems(ctx: RequestContext, items: SearchIndexItem[]) {
        // The primary key is derived from the entity metadata because it is dynamic:
        // the `indexCurrencyCode` option adds `currencyCode` as a fourth primary column.
        const primaryKeyProperties = this.connection.rawConnection
            .getMetadata(SearchIndexItem)
            .primaryColumns.map(column => column.propertyName);
        const dedupedItems = dedupeSearchIndexItems(items, primaryKeyProperties);
        const repository = this.connection.getRepository(ctx, SearchIndexItem);
        // A SearchIndexItem row binds ~24 parameters, so 500 rows per statement stays
        // safely within the bound-parameter limits of all supported drivers (the lowest
        // being sqlite's 32766).
        const chunkSize = 500;
        for (let i = 0; i < dedupedItems.length; i += chunkSize) {
            await repository.upsert(dedupedItems.slice(i, i + chunkSize), primaryKeyProperties);
        }
    }

    /**
     * Removes any synthetic variants for the given product
     */
    private async removeSyntheticVariants(ctx: RequestContext, variants: ProductVariant[]) {
        const prodIds = unique(variants.map(v => v.productId));
        for (const productId of prodIds) {
            await this.queue.push(() =>
                this.connection.getRepository(ctx, SearchIndexItem).delete({
                    productId,
                    sku: '',
                    price: 0,
                }),
            );
        }
    }

    private getTranslation<T extends Translatable>(
        translatable: T,
        languageCode: LanguageCode,
    ): Translation<T> {
        return (translatable.translations.find(t => t.languageCode === languageCode) ||
            translatable.translations.find(t => t.languageCode === this.configService.defaultLanguageCode) ||
            translatable.translations[0]) as unknown as Translation<T>;
    }

    private getFacetIds(variant: ProductVariant, product: Product): string[] {
        const facetIds = (fv: FacetValue) => fv.facet.id.toString();
        const variantFacetIds = variant.facetValues.map(facetIds);
        const productFacetIds = product.facetValues.map(facetIds);
        return unique([...variantFacetIds, ...productFacetIds]);
    }

    private getFacetValueIds(variant: ProductVariant, product: Product): string[] {
        const facetValueIds = (fv: FacetValue) => fv.id.toString();
        const variantFacetValueIds = variant.facetValues.map(facetValueIds);
        const productFacetValueIds = product.facetValues.map(facetValueIds);
        return unique([...variantFacetValueIds, ...productFacetValueIds]);
    }

    /**
     * Remove items from the search index
     */
    private async removeSearchIndexItems(
        ctx: RequestContext,
        variantIds: ID[],
        channelIds: ID[],
        ...languageCodes: LanguageCode[]
    ) {
        const keys: Array<Partial<SearchIndexItem>> = [];
        for (const productVariantId of variantIds) {
            for (const channelId of channelIds) {
                if (languageCodes.length > 0) {
                    for (const languageCode of languageCodes) {
                        keys.push({
                            productVariantId,
                            channelId,
                            languageCode,
                        });
                    }
                } else {
                    keys.push({
                        productVariantId,
                        channelId,
                    });
                }
            }
        }
        await this.queue.push(() => this.connection.getRepository(ctx, SearchIndexItem).delete(keys as any));
    }

    /**
     * Prevent postgres errors from too-long indices
     * https://github.com/vendurehq/vendure/issues/745
     */
    private constrainDescription(description: string): string {
        const { type } = this.connection.rawConnection.options;
        const isPostgresLike = type === 'postgres' || type === 'aurora-postgres' || type === 'cockroachdb';
        if (isPostgresLike) {
            return description.substring(0, 2600);
        }
        return description;
    }
}
