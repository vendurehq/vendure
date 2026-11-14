import { Args, Info, Parent, ResolveField, Resolver } from '@nestjs/graphql';
import { ProductVariantBuyerPriceArgs } from '@vendure/common/lib/generated-shop-types';
import {
    CurrencyCode,
    ProductVariantPrice,
    StockMovementListOptions,
} from '@vendure/common/lib/generated-types';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { PaginatedList } from '@vendure/common/lib/shared-types';
import { GraphQLResolveInfo, GraphQLSchema } from 'graphql';

import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { Translated } from '../../../common/types/locale-types';
import { idsAreEqual } from '../../../common/utils';
import { Asset, Channel, FacetValue, Product, ProductOption, StockLevel, TaxRate } from '../../../entity';
import { ProductVariantChannel } from '../../../entity/channel-assignment/channel-assignment.entities';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { StockMovement } from '../../../entity/stock-movement/stock-movement.entity';
import { ChannelAssignmentService } from '../../../service/helpers/channel-assignment/channel-assignment.service';
import { LocaleStringHydrator } from '../../../service/helpers/locale-string-hydrator/locale-string-hydrator';
import { AssetService } from '../../../service/services/asset.service';
import { BuyerPriceResult, ProductVariantService } from '../../../service/services/product-variant.service';
import { StockLevelService } from '../../../service/services/stock-level.service';
import { StockMovementService } from '../../../service/services/stock-movement.service';
import { ApiType } from '../../common/get-api-type';
import { GraphqlValueTransformer } from '../../common/graphql-value-transformer';
import { IdCodecService } from '../../common/id-codec.service';
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
        private channelAssignmentService: ChannelAssignmentService,
    ) {}

    /**
     * The per-channel `enabled` value in the active Channel, from the ProductVariantChannel row. `false` if
     * it is not assigned to the active Channel.
     */
    @ResolveField()
    async enabledInChannel(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
    ): Promise<boolean> {
        const assignment = await this.channelAssignmentService.getAssignment<ProductVariantChannel>(
            ctx,
            ProductVariant,
            productVariant,
        );
        return assignment?.enabled ?? false;
    }

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

@Resolver('ProductVariant')
export class ProductVariantShopEntityResolver {
    private graphqlValueTransformers = new WeakMap<GraphQLSchema, GraphqlValueTransformer>();

    constructor(
        private productVariantService: ProductVariantService,
        private idCodecService: IdCodecService,
    ) {}

    @ResolveField()
    async buyerPrice(
        @Ctx() ctx: RequestContext,
        @Parent() productVariant: ProductVariant,
        // `customFields` exists when OrderLine custom fields are defined
        @Args() args: ProductVariantBuyerPriceArgs & { customFields?: Record<string, unknown> | null },
        @Info() info: GraphQLResolveInfo,
    ): Promise<BuyerPriceResult | undefined> {
        const { quantity, customFields } = this.decodeIdArguments(info, args);
        return this.productVariantService.calculateBuyerPrice(ctx, productVariant, {
            quantity: quantity ?? 1,
            data: customFields ?? undefined,
        });
    }

    /**
     * The IdInterceptor does not run for field resolvers, so this decodes the ID values in the
     * arguments, as `addItemToOrder` gets them. It decodes a copy, because the arguments can
     * contain a variable object that the field of each variant shares.
     */
    private decodeIdArguments<T extends Record<string, any>>(info: GraphQLResolveInfo, args: T): T {
        let transformer = this.graphqlValueTransformers.get(info.schema);
        if (!transformer) {
            transformer = new GraphqlValueTransformer(info.schema);
            this.graphqlValueTransformers.set(info.schema, transformer);
        }
        const field = info.parentType.getFields()[info.fieldName];
        const decoded = structuredClone(args);
        transformer.transformValues(transformer.getArgumentTypeTree(field), decoded, (value, type) =>
            type?.name === 'ID' ? this.idCodecService.decode(value) : value,
        );
        return decoded;
    }
}
