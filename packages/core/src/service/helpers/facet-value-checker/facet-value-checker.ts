import { Injectable, OnModuleInit } from '@nestjs/common';
import { UpdateProductInput, UpdateProductVariantInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import ms from 'ms';
import { filter } from 'rxjs/operators';

import { RequestContext } from '../../../api/index';
import { CacheService } from '../../../cache/cache.service';
import { RequestContextCacheService } from '../../../cache/request-context-cache.service';
import { idsAreEqual } from '../../../common/utils';
import { TransactionalConnection } from '../../../connection/transactional-connection';
import { OrderLine } from '../../../entity/order-line/order-line.entity';
import { ProductVariant } from '../../../entity/product-variant/product-variant.entity';
import { EventBus, ProductEvent, ProductVariantEvent } from '../../../event-bus/index';

/**
 * @description
 * The FacetValueChecker is a helper class used to determine whether a given OrderLine consists
 * of ProductVariants containing the given FacetValues.
 *
 * @example
 * ```ts
 * import { FacetValueChecker, LanguageCode, PromotionCondition, TransactionalConnection } from '\@vendure/core';
 *
 * let facetValueChecker: FacetValueChecker;
 *
 * export const hasFacetValues = new PromotionCondition({
 *   code: 'at_least_n_with_facets',
 *   description: [
 *     { languageCode: LanguageCode.en, value: 'Buy at least { minimum } products with the given facets' },
 *   ],
 *   args: {
 *     minimum: { type: 'int' },
 *     facets: { type: 'ID', list: true, ui: { component: 'facet-value-form-input' } },
 *   },
 *   init(injector) {
 *     facetValueChecker = injector.get(FacetValueChecker);
 *   },
 *   async check(ctx, order, args) {
 *     let matches = 0;
 *     for (const line of order.lines) {
 *       if (await facetValueChecker.hasFacetValues(line, args.facets, ctx)) {
 *           matches += line.quantity;
 *       }
 *     }
 *     return args.minimum <= matches;
 *   },
 * });
 * ```
 *
 * @docsCategory Promotions
 */
@Injectable()
export class FacetValueChecker implements OnModuleInit {
    /**
     * @deprecated
     * Do not directly instantiate. Use the injector to get an instance:
     *
     * ```ts
     * facetValueChecker = injector.get(FacetValueChecker);
     * ```
     * @param connection
     */
    constructor(
        private connection: TransactionalConnection,
        private cacheService: CacheService,
        private eventBus?: EventBus,
        private requestContextCache?: RequestContextCacheService,
    ) {}

    private facetValueCache = this.cacheService.createCache({
        getKey: (variantId: ID) => this.getCacheKey(variantId),
        options: { ttl: ms('1w') },
    });

    onModuleInit(): any {
        this.eventBus
            ?.ofType(ProductEvent)
            .pipe(filter(event => event.type === 'updated'))
            .subscribe(async event => {
                if ((event.input as UpdateProductInput)?.facetValueIds) {
                    const variantIds: ID[] = await this.connection.rawConnection
                        .getRepository(ProductVariant)
                        .createQueryBuilder('variant')
                        .select('variant.id', 'id')
                        .where('variant.productId = :prodId', { prodId: event.product.id })
                        .getRawMany()
                        .then(result => result.map(r => r.id));

                    if (variantIds.length) {
                        await this.facetValueCache.delete(variantIds);
                    }
                }
            });

        this.eventBus
            ?.ofType(ProductVariantEvent)
            .pipe(filter(event => event.type === 'updated'))
            .subscribe(async event => {
                const updatedVariantIds: ID[] = [];
                if (Array.isArray(event.input)) {
                    for (const input of event.input) {
                        if ((input as UpdateProductVariantInput)?.facetValueIds) {
                            updatedVariantIds.push((input as UpdateProductVariantInput).id);
                        }
                    }
                }
                if (updatedVariantIds.length) {
                    await this.facetValueCache.delete(updatedVariantIds);
                }
            });
    }

    /**
     * @description
     * Checks a given {@link OrderLine} against the facetValueIds and returns
     * `true` if the associated {@link ProductVariant} & {@link Product} together
     * have *all* the specified {@link FacetValue}s.
     */
    async hasFacetValues(orderLine: OrderLine, facetValueIds: ID[], ctx?: RequestContext): Promise<boolean> {
        const variantId = orderLine.productVariant.id;
        // Promotion checks call this for the same variant many times while one order is
        // recalculated, so the cache lookup is shared for the rest of the request.
        const variantFacetValueIds =
            ctx && this.requestContextCache
                ? await this.requestContextCache.get(ctx, this.getCacheKey(variantId), () =>
                      this.getVariantFacetValueIds(orderLine, ctx),
                  )
                : await this.getVariantFacetValueIds(orderLine, ctx);
        return facetValueIds.reduce(
            (result, id) => result && !!(variantFacetValueIds ?? []).find(_id => idsAreEqual(_id, id)),
            true as boolean,
        );
    }

    private getCacheKey(variantId: ID): string {
        return `FacetValueChecker.${variantId}`;
    }

    private getVariantFacetValueIds(orderLine: OrderLine, ctx?: RequestContext): Promise<ID[]> {
        const variantId = orderLine.productVariant.id;
        return this.facetValueCache.get(variantId, async () => {
            const variant = await this.connection
                .getRepository(ctx, ProductVariant)
                .findOne({
                    where: { id: orderLine.productVariant.id },
                    relations: { product: { facetValues: true }, facetValues: true },
                    loadEagerRelations: false,
                })
                .then(result => result ?? undefined);
            if (!variant) {
                return [];
            } else {
                return unique([...variant.facetValues, ...variant.product.facetValues].map(fv => fv.id));
            }
        });
    }
}
