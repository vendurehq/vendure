import { Logger } from '@nestjs/common';
import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import {
    CollectionBreadcrumb,
    ConfigurableOperation,
    ProductVariantListOptions,
} from '@vendure/common/lib/generated-types';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { ListQueryOptions } from '../../../common/types/common-types';
import { Translated } from '../../../common/types/locale-types';
import { CollectionFilter } from '../../../config/catalog/collection-filter';
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

        // Check if count was pre-loaded in findAll
        const cachedCount = (collection as Collection & { __productVariantCount: number })
            .__productVariantCount;

        // Fetch items, passing cached count to avoid redundant count query when available
        return this.productVariantService.getVariantsByCollectionId(
            ctx,
            collection.id,
            options,
            relations,
            cachedCount,
        );
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
