import { Args, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import {
    CurrencyCode,
    ProductVariantPrice,
    StockMovementListOptions,
} from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { PaginatedList } from '@vendure/common/lib/shared-types';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { Translated } from '../../../common/types/locale-types';
import { idsAreEqual } from '../../../common/utils';
import { Asset, Channel, FacetValue, Product, ProductOption, StockLevel, TaxRate } from '../../../entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { StockMovement } from '../../../entity/stock-movement/stock-movement.entity';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { AssetService } from '../../../service/services/asset.service';
import { ProductVariantService } from '../../../service/services/product-variant.service';
import { StockLevelService } from '../../../service/services/stock-level.service';
import { StockMovementService } from '../../../service/services/stock-movement.service';
import { ApiType } from '../../common/get-api-type';
import { RequestContext } from '../../common/request-context';
import { Api } from '../../decorators/api.decorator';
import { Ctx } from '../../decorators/request-context.decorator';

@Resolver('ProductVariant')
export class ProductVariantEntityResolver {
    constructor(
        private productVariantService: ProductVariantService,
        private assetService: AssetService,
        private localeStringHydrator: LocaleStringHydrator,
        private requestContextCache: RequestContextCacheService,
    ) {}

    @ResolveField()
    async name(@Ctx() ctx: RequestContext, @Parent() productVariant: ProductVariant): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, productVariant, 'name');
    }

    @ResolveField()
    async languageCode(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<string> {
        return this.localeStringHydrator.hydrateLocaleStringField(ctx, productVariant, 'languageCode');
    }

    @ResolveField()
    async price(@Ctx() ctx: RequestContext, @Parent() productVariant: ProductVariant): Promise<number> {
        return this.productVariantService.hydratePriceFields(ctx, productVariant, 'price');
    }

    @ResolveField()
    async priceWithTax(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<number> {
        return this.productVariantService.hydratePriceFields(ctx, productVariant, 'priceWithTax');
    }

    @ResolveField()
    async currencyCode(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<CurrencyCode> {
        return this.productVariantService.hydratePriceFields(ctx, productVariant, 'currencyCode');
    }

    @ResolveField()
    async taxRateApplied(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<TaxRate> {
        return this.productVariantService.hydratePriceFields(ctx, productVariant, 'taxRateApplied');
    }

    @ResolveField()
    async product(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<Product | undefined> {
        if (productVariant.product?.name) {
            return productVariant.product;
        }

        return this.requestContextCache.get(
            ctx,
            `ProductVariantEntityResolver.product(${productVariant.productId})`,
            () => this.productVariantService.getProductForVariant(ctx, productVariant),
        );
    }

    @ResolveField()
    async assets(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<Asset[] | undefined> {
        return this.assetService.getEntityAssets(ctx, productVariant);
    }

    @ResolveField()
    async featuredAsset(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<Asset | undefined> {
        if (productVariant.featuredAsset !== undefined) {
            return productVariant.featuredAsset;
        }
        return this.assetService.getFeaturedAsset(ctx, productVariant);
    }

    @ResolveField()
    async options(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<Array<Translated<ProductOption>>> {
        if (productVariant.options) {
            return productVariant.options as Array<Translated<ProductOption>>;
        }
        return this.productVariantService.getOptionsForVariant(ctx, productVariant.id);
    }

    @ResolveField()
    async facetValues(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
        @Api() apiType: ApiType,
    ): Promise<Array<Translated<FacetValue>>> {
        if (productVariant.facetValues?.length === 0) {
            return [];
        }
        let facetValues: Array<Translated<FacetValue>>;
        if (productVariant.facetValues?.[0]?.channels) {
            facetValues = productVariant.facetValues as Array<Translated<FacetValue>>;
        } else {
            facetValues = await this.productVariantService.getFacetValuesForVariant(ctx, productVariant.id);
        }

        return facetValues.filter(fv => {
            if (!fv.channels.find(c => idsAreEqual(c.id, ctx.channelId))) {
                return false;
            }
            if (apiType === 'shop' && fv.facet.isPrivate) {
                return false;
            }
            return true;
        });
    }

    @ResolveField()
    async stockLevel(@Ctx() ctx: RequestContext, @Parent() productVariant: ProductVariant): Promise<string> {
        return this.productVariantService.getDisplayStockLevel(ctx, productVariant);
    }
}

@Resolver('ProductVariant')
export class ProductVariantAdminEntityResolver {
    constructor(
        private productVariantService: ProductVariantService,
        private stockMovementService: StockMovementService,
        private stockLevelService: StockLevelService,
    ) {}

    @ResolveField()
    async stockMovements(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
        @Args() args: { options: StockMovementListOptions },
    ): Promise<PaginatedList<StockMovement>> {
        return this.stockMovementService.getStockMovementsByProductVariantId(
            ctx,
            productVariant.id,
            args.options,
        );
    }

    @ResolveField()
    async stockOnHand(@Ctx() ctx: RequestContext, @Parent() productVariant: ProductVariant): Promise<number> {
        const { stockOnHand } = await this.stockLevelService.getAvailableStock(ctx, productVariant.id);
        return stockOnHand;
    }

    @ResolveField()
    async stockAllocated(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
        @Args() args: { options: StockMovementListOptions },
    ): Promise<number> {
        const { stockAllocated } = await this.stockLevelService.getAvailableStock(ctx, productVariant.id);
        return stockAllocated;
    }

    @ResolveField()
    async channels(@Ctx() ctx: RequestContext, @Parent() productVariant: ProductVariant): Promise<Channel[]> {
        const isDefaultChannel = ctx.channel.code === DEFAULT_CHANNEL_CODE;
        const channels = await this.productVariantService.getProductVariantChannels(ctx, productVariant.id);
        return channels.filter(channel => (isDefaultChannel ? true : idsAreEqual(channel.id, ctx.channelId)));
    }

    @ResolveField()
    async stockLevels(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<StockLevel[]> {
        return this.stockLevelService.getStockLevelsForVariant(ctx, productVariant.id);
    }

    @ResolveField()
    async prices(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<ProductVariantPrice[]> {
        if (productVariant.productVariantPrices) {
            return productVariant.productVariantPrices.filter(pvp =>
                idsAreEqual(pvp.channelId, ctx.channelId),
            );
        }
        return this.productVariantService.getProductVariantPrices(ctx, productVariant.id);
    }
}
