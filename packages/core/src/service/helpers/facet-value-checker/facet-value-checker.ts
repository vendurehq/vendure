import { Injectable, OnModuleInit } from '@nestjs/common';
import { UpdateProductInput, UpdateProductVariantInput } from '@vendure/common/lib/generated-types';
import { ID } from '@vendure/common/lib/shared-types';
import { unique } from '@vendure/common/lib/unique';
import ms from 'ms';
import { filter } from 'rxjs/operators';

import { RequestContext } from '../../../api/index';
import { CacheService } from '../../../cache/cache.service';
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
 *       if (await facetValueChecker.hasFacetValues(line, args.facets)) {
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
    ) {}

    private facetValueCache = this.cacheService.createCache({
        getKey: (variantId: ID) => `FacetValueChecker.${variantId}`,
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
        const variantFacetValueIds = await this.facetValueCache.get(variantId, async () => {
            const variant = await this.connection
                .getRepository(ctx, ProductVariant)
                .findOne({
                    where: { id: orderLine.productVariant.id },
                    relations: ['product', 'product.facetValues', 'facetValues'],
                    loadEagerRelations: false,
                })
                .then(result => result ?? undefined);
            if (!variant) {
                return [];
            } else {
                return unique([...variant.facetValues, ...variant.product.facetValues].map(fv => fv.id));
            }
        });
        return facetValueIds.reduce(
            (result, id) => result && !!(variantFacetValueIds ?? []).find(_id => idsAreEqual(_id, id)),
            true as boolean,
        );
    }
}
