import { ID } from '@vendure/common/lib/shared-types';
import DataLoader from 'dataloader';

import { RequestContext } from '../../api/common/request-context';
import { RequestContextCacheService } from '../../cache/request-context-cache.service';
import { Injector } from '../../common/injector';
import { idsAreEqual } from '../../common/utils';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

import { ProductVariantPriceLoadingStrategy } from './product-variant-price-loading-strategy';

/**
 * @description
 * A {@link ProductVariantPriceLoadingStrategy} that loads only the price rows of the active
 * Channel. `ProductVariant.productVariantPrices` is no longer eager, and when a variant is priced,
 * the rows of the RequestContext's Channel are loaded for every variant priced in the same tick in
 * one query. What a request reads then no longer grows with the number of Channels a variant is
 * assigned to.
 *
 * Code that reads `variant.productVariantPrices` after a plain repository query finds it empty
 * under this strategy, unless the query requested the relation; code that goes through
 * {@link ProductPriceApplicator} or the GraphQL APIs is unaffected.
 *
 * @example
 * ```ts
 * import { ActiveChannelProductVariantPriceLoadingStrategy, VendureConfig } from '\@vendure/core';
 *
 * export const config: VendureConfig = {
 *   catalogOptions: {
 *     productVariantPriceLoadingStrategy: new ActiveChannelProductVariantPriceLoadingStrategy(),
 *   },
 * };
 * ```
 *
 * @docsCategory configuration
 * @docsPage ProductVariantPriceLoadingStrategy
 * @since 3.8.0
 */
export class ActiveChannelProductVariantPriceLoadingStrategy implements ProductVariantPriceLoadingStrategy {
    readonly eagerLoading = false;
    private connection: TransactionalConnection;
    private requestCache: RequestContextCacheService;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
        this.requestCache = injector.get(RequestContextCacheService);
    }

    async loadPrices(ctx: RequestContext, variant: ProductVariant): Promise<ProductVariantPrice[]> {
        const loaded = variant.productVariantPrices?.filter(price =>
            idsAreEqual(price.channelId, ctx.channelId),
        );
        if (loaded?.length) {
            return loaded;
        }
        return this.getLoader(ctx, ctx.channelId).load(variant.id);
    }

    /**
     * One loader per RequestContext and Channel. The search indexers price one variant object in
     * every Channel of its product in turn by switching the Channel of a single RequestContext, so
     * the Channel is part of the key and captured here, not read from the context when the batch
     * runs. `cache: false` batches without memoizing, as the StockLevelService does, so a price
     * written earlier in the request is not masked.
     */
    private getLoader(ctx: RequestContext, channelId: ID): DataLoader<ID, ProductVariantPrice[]> {
        return this.requestCache.get(
            ctx,
            `ActiveChannelProductVariantPriceLoadingStrategy.${String(channelId)}`,
            () =>
                new DataLoader<ID, ProductVariantPrice[]>(
                    variantIds => this.batchLoad(ctx, channelId, variantIds as ID[]),
                    { cache: false },
                ),
        );
    }

    private async batchLoad(
        ctx: RequestContext,
        channelId: ID,
        variantIds: ID[],
    ): Promise<ProductVariantPrice[][]> {
        const uniqueIds = [...new Map(variantIds.map(id => [String(id), id])).values()];
        // ProductVariantPrice has no `variantId` property, so the id of the variant comes from the
        // raw row of the same query.
        const { entities, raw } = await this.connection
            .getRepository(ctx, ProductVariantPrice)
            .createQueryBuilder('price')
            .where('price.variant IN (:...variantIds)', { variantIds: uniqueIds })
            .andWhere('price.channelId = :channelId', { channelId })
            .getRawAndEntities();
        const byVariantId = new Map<string, ProductVariantPrice[]>();
        entities.forEach((price, index) => {
            const variantId = String(raw[index].price_variantId);
            const rows = byVariantId.get(variantId);
            if (rows) {
                rows.push(price);
            } else {
                byVariantId.set(variantId, [price]);
            }
        });
        return variantIds.map(id => byVariantId.get(String(id)) ?? []);
    }
}
