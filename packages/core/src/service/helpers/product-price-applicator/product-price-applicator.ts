import { Injectable } from '@nestjs/common';
import { ID } from '@vendure/common/lib/shared-types';
import DataLoader from 'dataloader';
import { In } from 'typeorm';

import { RequestContext } from '../../../api/common/request-context';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { CacheKey } from '../../../common/constants';
import { InternalServerError } from '../../../common/error/errors';
import { idsAreEqual } from '../../../common/utils';
import { ConfigService } from '../../../config/config.service';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { Order } from '../../../entity/order/order.entity';
import { ProductVariantPrice } from '../../../entity/product-variant/product-variant-price.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { TaxRateService } from '../../services/tax-rate.service';
import { ZoneService } from '../../services/zone.service';
import { resolveTaxCountryCode } from '../utils/resolve-tax-country-code';

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
        private connection: TransactionalConnection,
    ) {}

    /**
     * @description
     * Populates the `price` field with the price for the specified channel. Make sure that
     * the ProductVariant being passed in has its `taxCategory` relation joined.
     *
     * The price rows of the Channel of `ctx` are loaded if the variant does not already carry them,
     * batched with the other variants priced in the same tick. `ProductVariant.productVariantPrices`
     * is not an eager relation, so a query which only loads a variant to price it need not request
     * it. Rows of other Channels which the variant already carries are kept.
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
        const { productVariantPriceSelectionStrategy, productVariantPriceCalculationStrategy } =
            this.configService.catalogOptions;
        await this.ensureChannelPricesLoaded(ctx, variant);
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
            CacheKey.ActiveTaxZone_PPA(ctx.channelId, order?.id),
            () => taxZoneStrategy.determineTaxZone(ctx, zones, ctx.channel, order),
        );
        if (!activeTaxZone) {
            throw new InternalServerError('error.no-active-tax-zone');
        }
        // Not cached on the request: with no Order, the country can differ from an Order's.
        const countryCode = await resolveTaxCountryCode(
            taxZoneStrategy,
            ctx,
            ctx.channel,
            activeTaxZone,
            order,
        );
        const applicableTaxRate = await this.requestCache.get(
            ctx,
            `applicableTaxRate-${activeTaxZone.id}-${countryCode ?? ''}-${variant.taxCategory.id}`,
            () =>
                this.taxRateService.getApplicableTaxRate(
                    ctx,
                    { countryCode, zone: activeTaxZone },
                    variant.taxCategory,
                ),
        );

        const { price, priceIncludesTax } = await productVariantPriceCalculationStrategy.calculate({
            inputPrice: channelPrice?.price ?? 0,
            productVariantPrice: channelPrice,
            taxCategory: variant.taxCategory,
            productVariant: variant,
            activeTaxZone,
            ctx,
            taxRate: applicableTaxRate,
        });

        variant.listPrice = price;
        variant.listPriceIncludesTax = priceIncludesTax;
        variant.taxRateApplied = applicableTaxRate;
        variant.currencyCode = channelPrice?.currencyCode ?? ctx.currencyCode;
        return variant;
    }

    /**
     * @description
     * Loads the prices of the Channel of `ctx` for every given variant which does not carry them
     * yet, in one query. `applyChannelPriceAndTax()` loads them itself, batched with the variants
     * priced in the same tick, so call this first only when pricing variants one after the other,
     * for example in a loop which awaits each one.
     *
     * @since 4.0.0
     */
    async preloadChannelPrices(ctx: RequestContext, variants: ProductVariant[]): Promise<void> {
        await Promise.all(variants.map(variant => this.ensureChannelPricesLoaded(ctx, variant)));
    }

    /**
     * Adds the price rows of the Channel of `ctx` to the variant, unless it already carries some.
     * A variant with no price in the Channel is queried again each time, which only costs a query
     * for a variant that cannot be sold there.
     */
    private async ensureChannelPricesLoaded(ctx: RequestContext, variant: ProductVariant): Promise<void> {
        const loaded = variant.productVariantPrices ?? [];
        if (loaded.some(price => idsAreEqual(price.channelId, ctx.channelId))) {
            return;
        }
        const channelPrices = await this.getChannelPriceLoader(ctx, ctx.channelId).load(variant.id);
        // Keep the rows of other Channels: the search indexer prices one variant object in every
        // Channel of its Product in turn.
        variant.productVariantPrices = [...loaded, ...channelPrices];
    }

    /**
     * One loader per RequestContext and Channel. The search indexer switches the Channel of a
     * single RequestContext, so the Channel is part of the key, and captured here rather than read
     * from the context when the batch runs. `cache: false` batches without memoizing, as the
     * StockLevelService does, so a price written earlier in the request is not masked.
     */
    private getChannelPriceLoader(ctx: RequestContext, channelId: ID): DataLoader<ID, ProductVariantPrice[]> {
        return this.requestCache.get(
            ctx,
            `ProductPriceApplicator.channelPrices.${String(channelId)}`,
            () =>
                new DataLoader<ID, ProductVariantPrice[]>(
                    variantIds => this.batchLoadChannelPrices(ctx, channelId, variantIds as ID[]),
                    { cache: false },
                ),
        );
    }

    private async batchLoadChannelPrices(
        ctx: RequestContext,
        channelId: ID,
        variantIds: ID[],
    ): Promise<ProductVariantPrice[][]> {
        const uniqueIds = [...new Map(variantIds.map(id => [String(id), id])).values()];
        const prices = await this.connection.getRepository(ctx, ProductVariantPrice).find({
            where: { variantId: In(uniqueIds), channelId },
            loadEagerRelations: false,
        });
        const byVariantId = new Map<string, ProductVariantPrice[]>();
        for (const price of prices) {
            const variantId = String(price.variantId);
            byVariantId.set(variantId, [...(byVariantId.get(variantId) ?? []), price]);
        }
        return variantIds.map(id => byVariantId.get(String(id)) ?? []);
    }
}
