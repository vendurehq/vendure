import { Injectable } from '@nestjs/common';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { CacheKey } from '../../../common/constants';
import { InternalServerError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { Order } from '../../../entity/order/order.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { TaxRateService } from '../../services/tax-rate.service';
import { ZoneService } from '../../services/zone.service';

/**
 * @description
 * This helper is used to apply the correct price to a ProductVariant based on the current context
 * including active Channel, any current Order, etc. If you use the {@link TransactionalConnection} to
 * directly query ProductVariants, you will find that the `price` and `priceWithTax` properties will
 * always be `0` until you use the `applyChannelPriceAndTax()` method:
 *
 * @example
 * ```ts
 * export class MyCustomService {
 *   constructor(private connection: TransactionalConnection,
 *               private productPriceApplicator: ProductPriceApplicator) {}
 *
 *   getVariant(ctx: RequestContext, id: ID) {
 *     const productVariant = await this.connection
 *       .getRepository(ctx, ProductVariant)
 *       .findOne(id, { relations: ['taxCategory'] });
 *
 *     await this.productPriceApplicator
 *       .applyChannelPriceAndTax(productVariant, ctx);
 *
 *     return productVariant;
 *   }
 * }
 * ```
 *
 * @docsCategory service-helpers
 */
@Injectable()
export class ProductPriceApplicator {
    constructor(
        private configService: ConfigService,
        private taxRateService: TaxRateService,
        private zoneService: ZoneService,
        private requestCache: RequestContextCacheService,
    ) {}

    /**
     * @description
     * Whether `ProductVariant.productVariantPrices` is an eager relation, loaded with every
     * variant. When `false`, the configured {@link ProductVariantPriceLoadingStrategy} loads the
     * price rows when `applyChannelPriceAndTax()` runs, so a query that only loads a variant in
     * order to price it does not have to request the relation.
     *
     * @since 3.8.0
     */
    get loadsPricesEagerly(): boolean {
        return this.configService.catalogOptions.productVariantPriceLoadingStrategy.eagerLoading;
    }

    /**
     * @description
     * Populates the `price` field with the price for the specified channel. Make sure that
     * the ProductVariant being passed in has its `taxCategory` relation joined. The price rows
     * come from the configured {@link ProductVariantPriceLoadingStrategy}; by default they are
     * the eagerly-loaded `productVariantPrices` of the variant.
     *
     * If the `throwIfNoPriceFound` option is set to `true`, then an error will be thrown if no
     * price is found for the given Channel.
     */
    async applyChannelPriceAndTax(
        variant: ProductVariant,
        ctx: RequestContext,
        order?: Order,
        throwIfNoPriceFound = false,
    ): Promise<ProductVariant> {
        const {
            productVariantPriceLoadingStrategy,
            productVariantPriceSelectionStrategy,
            productVariantPriceCalculationStrategy,
        } = this.configService.catalogOptions;
        const loadedPrices = await productVariantPriceLoadingStrategy.loadPrices(ctx, variant);
        if (loadedPrices !== variant.productVariantPrices) {
            // Keep the rows of other Channels a variant already carries: the search indexers price
            // one variant object in every Channel of its product in turn.
            const pricesOfOtherChannels = (variant.productVariantPrices ?? []).filter(
                row => !loadedPrices.includes(row) && !idsAreEqual(row.channelId, ctx.channelId),
            );
            variant.productVariantPrices = [...pricesOfOtherChannels, ...loadedPrices];
        }
        const channelPrice = await productVariantPriceSelectionStrategy.selectPrice(
            ctx,
            variant.productVariantPrices,
        );
        if (!channelPrice && throwIfNoPriceFound) {
            throw new InternalServerError('error.no-price-found-for-channel', {
                variantId: variant.id,
                channel: ctx.channel.code,
            });
        }
        const { taxZoneStrategy } = this.configService.taxOptions;
        const zones = await this.requestCache.get(ctx, CacheKey.AllZones, () =>
            this.zoneService.getAllWithMembers(ctx),
        );
        const activeTaxZone = await this.requestCache.get(
            ctx,
            CacheKey.ActiveTaxZone_PPA(ctx.channelId),
            () => taxZoneStrategy.determineTaxZone(ctx, zones, ctx.channel, order),
        );
        if (!activeTaxZone) {
            throw new InternalServerError('error.no-active-tax-zone');
        }
        const applicableTaxRate = await this.requestCache.get(
            ctx,
            `applicableTaxRate-${activeTaxZone.id}-${variant.taxCategory.id}`,
            () => this.taxRateService.getApplicableTaxRate(ctx, activeTaxZone, variant.taxCategory),
        );

        const { price, priceIncludesTax } = await productVariantPriceCalculationStrategy.calculate({
            inputPrice: channelPrice?.price ?? 0,
            productVariantPrice: channelPrice,
            taxCategory: variant.taxCategory,
            productVariant: variant,
            activeTaxZone,
            ctx,
        });

        variant.listPrice = price;
        variant.listPriceIncludesTax = priceIncludesTax;
        variant.taxRateApplied = applicableTaxRate;
        variant.currencyCode = channelPrice?.currencyCode ?? ctx.currencyCode;
        return variant;
    }
}
