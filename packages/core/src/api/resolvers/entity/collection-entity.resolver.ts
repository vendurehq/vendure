import { Logger } from '@nestjs/common';
import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import {
    CollectionBreadcrumb,
    ConfigurableOperation,
    ProductVariantListOptions,
} from '@vendure/common/lib/generated-types';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { CacheKey, COLLECTION_VARIANTS_CACHE_RELATIONS } from '../../../common/constants';
import { ListQueryOptions } from '../../../common/types/common-types';
import { Translated } from '../../../common/types/locale-types';
import { CollectionFilter } from '../../../config/catalog/collection-filter';
import { ConfigService } from '../../../config/config.service';
import { Asset, Collection, Product, ProductVariant } from '../../../entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { AssetService } from '../../../service/services/asset.service';
import { CollectionService } from '../../../service/services/collection.service';
import { ProductVariantService } from '../../../service/services/product-variant.service';
import { ConfigurableOperationCodec } from '../../common/configurable-operation-codec';
import { ApiType } from '../../common/get-api-type';
import { RequestContext } from '../../common/request-context';
import { Api } from '../../decorators/api.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Collection')
export class CollectionEntityResolver {
    constructor(
        private productVariantService: ProductVariantService,
        private collectionService: CollectionService,
        private assetService: AssetService,
        private localeStringHydrator: LocaleStringHydrator,
        private configurableOperationCodec: ConfigurableOperationCodec,
        private requestContextCache: RequestContextCacheService,
        private configService: ConfigService,
    ) {}

    @ResolveField()
    name(@Ctx() ctx: RequestContext, @Parent() collection: Collection): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, collection, 'name');
    }

    @ResolveField()
    slug(@Ctx() ctx: RequestContext, @Parent() collection: Collection): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, collection, 'slug');
    }

    @ResolveField()
    description(@Ctx() ctx: RequestContext, @Parent() collection: Collection): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, collection, 'description');
    }

    @ResolveField()
    languageCode(@Ctx() ctx: RequestContext, @Parent() collection: Collection): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, collection, 'languageCode');
    }

    @ResolveField()
    async productVariants(
        @Ctx() ctx: RequestContext,
        @Parent() collection: Collection,
        @Args() args: { options: ProductVariantListOptions },
        @Api() apiType: ApiType,
        @Relations({ entity: ProductVariant, omit: ['assets'] }) relations: RelationPaths<ProductVariant>,
    ): Promise<PaginatedList<Translated<ProductVariant>>> {
        const isDefaultOptions = !args.options || Object.keys(args.options).length === 0;
        if (isDefaultOptions && apiType === 'admin') {
            const cachedVariantsPromise = this.requestContextCache.get<
                Promise<Map<string, ProductVariant[]>>
            >(ctx, CacheKey.CollectionVariants);
            if (cachedVariantsPromise) {
                const variantsMap = await cachedVariantsPromise;
                const variants = variantsMap.get(String(collection.id));
                if (variants) {
                    // Check if the requested relations are compatible with the cached data.
                    // The cache was populated with default relations defined by COLLECTION_VARIANTS_CACHE_RELATIONS.
                    // We can use the cache ONLY if the requested relations are a subset of or equal to the default relations.
                    const isCacheCompatible = relations.every(rel =>
                        (COLLECTION_VARIANTS_CACHE_RELATIONS as readonly string[]).includes(rel),
                    );

                    if (isCacheCompatible) {
                        // Cache is compatible, use it.
                        const { adminListQueryLimit } = this.configService.apiOptions;
                        const skip = args.options?.skip ?? 0;
                        const take = args.options?.take ?? adminListQueryLimit;
                        const items = await this.productVariantService.applyPricesAndTranslateVariants(
                            ctx,
                            variants.slice(skip, skip + take),
                        );
                        return {
                            items,
                            totalItems: variants.length,
                        };
                    }
                }
            }
        }

        let options: ListQueryOptions<Product> = args.options;
        if (apiType === 'shop') {
            options = {
                ...args.options,
                filter: {
                    ...(args.options ? args.options.filter : {}),
                    enabled: { eq: true },
                },
            };
        }
        return this.productVariantService.getVariantsByCollectionId(ctx, collection.id, options, relations);
    }

    @ResolveField()
    async productVariantCount(@Ctx() ctx: RequestContext, @Parent() collection: Collection): Promise<number> {
        const cachedCountsPromise = this.requestContextCache.get<Promise<Map<ID, number>>>(
            ctx,
            CacheKey.CollectionVariantCounts,
        );
        if (cachedCountsPromise) {
            const countsMap = await cachedCountsPromise;
            return countsMap.get(String(collection.id)) ?? 0;
        }
        // Fallback to single query if cache not available (e.g., single collection query)
        const singleCountMap = await this.collectionService.getProductVariantCounts(ctx, [collection.id]);
        return singleCountMap.get(String(collection.id)) ?? 0;
    }

    @ResolveField()
    async breadcrumbs(
        @Ctx() ctx: RequestContext,
        @Parent() collection: Collection,
    ): Promise<CollectionBreadcrumb[]> {
        return this.collectionService.getBreadcrumbs(ctx, collection);
    }

    @ResolveField()
    async parent(
        @Ctx() ctx: RequestContext,
        @Parent() collection: Collection,
        @Api() apiType: ApiType,
    ): Promise<Collection | undefined> {
        let parent: Collection | undefined;
        if (collection.parent) {
            parent = collection.parent;
        } else {
            parent = await this.collectionService.getParent(ctx, collection.id);
        }
        return apiType === 'shop' && parent?.isPrivate ? undefined : parent;
    }

    @ResolveField()
    async children(
        @Ctx() ctx: RequestContext,
        @Parent() collection: Collection,
        @Api() apiType: ApiType,
    ): Promise<Collection[]> {
        let children: Collection[] = [];
        if (collection.children) {
            children = collection.children.sort((a, b) => a.position - b.position);
        } else {
            children = (await this.collectionService.getChildren(ctx, collection.id)) as any;
        }
        return children.filter(c => (apiType === 'shop' ? !c.isPrivate : true));
    }

    @ResolveField()
    async featuredAsset(
        @Ctx() ctx: RequestContext,
        @Parent() collection: Collection,
    ): Promise<Asset | undefined> {
        if (collection.featuredAsset !== undefined) {
            return collection.featuredAsset;
        }
        return this.assetService.getFeaturedAsset(ctx, collection);
    }

    @ResolveField()
    async assets(@Ctx() ctx: RequestContext, @Parent() collection: Collection): Promise<Asset[] | undefined> {
        return this.assetService.getEntityAssets(ctx, collection);
    }

    @ResolveField()
    filters(@Ctx() ctx: RequestContext, @Parent() collection: Collection): ConfigurableOperation[] {
        try {
            return this.configurableOperationCodec.encodeConfigurableOperationIds(
                CollectionFilter,
                collection.filters,
            );
        } catch (e: any) {
            Logger.error(
                `Could not decode the collection filter arguments for "${collection.name}" (id: ${
                    collection.id
                }). Error message: ${JSON.stringify(e.message)}`,
            );
            return [];
        }
    }
}
