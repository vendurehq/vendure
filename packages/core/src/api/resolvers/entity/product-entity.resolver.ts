import { Args, Info, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ProductVariantListOptions } from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { ID, PaginatedList } from '@vendure/common/lib/shared-types';
import DataLoader from 'dataloader';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { Translated } from '../../../common/types/locale-types';
import { idsAreEqual } from '../../../common/utils';
import { Asset } from '../../../entity/asset/asset.entity';
import { Channel } from '../../../entity/channel/channel.entity';
import { Collection } from '../../../entity/collection/collection.entity';
import { FacetValue } from '../../../entity/facet-value/facet-value.entity';
import { Product } from '../../../entity/product/product.entity';
import { ProductOptionGroup } from '../../../entity/product-option-group/product-option-group.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { AssetService } from '../../../service/services/asset.service';
import { CollectionService } from '../../../service/services/collection.service';
import { FacetValueService } from '../../../service/services/facet-value.service';
import { ProductOptionGroupService } from '../../../service/services/product-option-group.service';
import { ProductVariantService } from '../../../service/services/product-variant.service';
import { ProductService } from '../../../service/services/product.service';
import { ApiType } from '../../common/get-api-type';
import { RequestContext } from '../../common/request-context';
import { Api } from '../../decorators/api.decorator';
import { RelationPaths, Relations } from '../../decorators/relations.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('Product')
export class ProductEntityResolver {
    constructor(
        private productVariantService: ProductVariantService,
        private collectionService: CollectionService,
        private productOptionGroupService: ProductOptionGroupService,
        private assetService: AssetService,
        private productService: ProductService,
        private facetValueService: FacetValueService,
        private localeStringHydrator: LocaleStringHydrator,
        private requestCache: RequestContextCacheService,
    ) {}

    @ResolveField()
    name(@Ctx() ctx: RequestContext, @Parent() product: Product): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, product, 'name');
    }

    @ResolveField()
    slug(@Ctx() ctx: RequestContext, @Parent() product: Product): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, product, 'slug');
    }

    @ResolveField()
    description(@Ctx() ctx: RequestContext, @Parent() product: Product): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, product, 'description');
    }

    @ResolveField()
    languageCode(@Ctx() ctx: RequestContext, @Parent() product: Product): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, product, 'languageCode');
    }

    @ResolveField()
    async variants(
        @Ctx() ctx: RequestContext,
        @Parent() product: Product,
        @Relations({ entity: ProductVariant, omit: ['assets'] }) relations: RelationPaths<ProductVariant>,
    ): Promise<Array<Translated<ProductVariant>>> {
        return this.productVariantService.getVariantsForProduct(ctx, product.id, relations);
    }

    @ResolveField()
    async variantList(
        @Ctx() ctx: RequestContext,
        @Parent() product: Product,
        @Args() args: { options: ProductVariantListOptions },
        @Relations({ entity: ProductVariant, omit: ['assets'] }) relations: RelationPaths<ProductVariant>,
    ): Promise<PaginatedList<ProductVariant>> {
        return this.productVariantService.getVariantsByProductId(ctx, product.id, args.options, relations);
    }

    @ResolveField()
    async collections(
        @Ctx() ctx: RequestContext,
        @Parent() product: Product,
        @Api() apiType: ApiType,
    ): Promise<Array<Translated<Collection>>> {
        return this.collectionService.getCollectionsByProductId(ctx, product.id, apiType === 'shop');
    }

    @ResolveField()
    async optionGroups(
        @Info() info: any,
        @Ctx() ctx: RequestContext,
        @Parent() product: Product,
    ): Promise<Array<Translated<ProductOptionGroup>>> {
        return this.productOptionGroupService.getOptionGroupsByProductId(ctx, product.id);
    }

    @ResolveField()
    async facetValues(
        @Ctx() ctx: RequestContext,
        @Parent() product: Product,
        @Api() apiType: ApiType,
    ): Promise<Array<Translated<FacetValue>>> {
        if (product.facetValues?.length === 0) {
            return [];
        }
        let facetValues: Array<Translated<FacetValue>>;
        if (product.facetValues) {
            facetValues = product.facetValues as Array<Translated<FacetValue>>;
        } else {
            facetValues = await this.productService.getFacetValuesForProduct(ctx, product.id);
        }
        const loader = this.requestCache.get(
            ctx,
            'ProductEntityResolver.facetValues',
            () =>
                new DataLoader<ID[], Array<Translated<FacetValue>>>(
                    async groups => {
                        const ids = [...new Map(groups.flat().map(id => [String(id), id])).values()];
                        const values: Array<Translated<FacetValue>> = [];
                        for (let offset = 0; offset < ids.length; offset += 500) {
                            values.push(
                                ...(await this.facetValueService.findByIds(
                                    ctx,
                                    ids.slice(offset, offset + 500),
                                )),
                            );
                        }
                        return groups.map(group => {
                            const groupIds = new Set(group.map(String));
                            return values.filter(value => groupIds.has(String(value.id)));
                        });
                    },
                    { cache: false, maxBatchSize: 50 },
                ),
        );
        const filteredFacetValues = await loader.load(facetValues.map(value => value.id));

        if (apiType === 'shop') {
            return filteredFacetValues.filter(fv => !fv.facet.isPrivate);
        } else {
            return filteredFacetValues;
        }
    }

    @ResolveField()
    async featuredAsset(@Ctx() ctx: RequestContext, @Parent() product: Product): Promise<Asset | undefined> {
        if (product.featuredAsset !== undefined) {
            return product.featuredAsset;
        }
        return this.assetService.getFeaturedAsset(ctx, product);
    }

    @ResolveField()
    async assets(@Ctx() ctx: RequestContext, @Parent() product: Product): Promise<Asset[] | undefined> {
        return this.assetService.getEntityAssets(ctx, product);
    }
}

@Resolver('Product')
export class ProductAdminEntityResolver {
    constructor(private productService: ProductService) {}

    @ResolveField()
    async channels(@Ctx() ctx: RequestContext, @Parent() product: Product): Promise<Channel[]> {
        const isDefaultChannel = ctx.channel.code === DEFAULT_CHANNEL_CODE;
        const channels = product.channels || (await this.productService.getProductChannels(ctx, product.id));
        return channels.filter(channel => (isDefaultChannel ? true : idsAreEqual(channel.id, ctx.channelId)));
    }
}
