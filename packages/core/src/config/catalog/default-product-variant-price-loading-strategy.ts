import { RequestContext } from '../../api/common/request-context';
import { Injector } from '../../common/injector';
import { TransactionalConnection } from '../../connection/transactional-connection';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';

import { ProductVariantPriceLoadingStrategy } from './product-variant-price-loading-strategy';

/**
 * @description
 * The default {@link ProductVariantPriceLoadingStrategy}: `ProductVariant.productVariantPrices`
 * is an eager relation, so a variant normally arrives with the price rows of every Channel. When a
 * variant was loaded without them, they are loaded for every Channel in one query.
 *
 * @docsCategory configuration
 * @docsPage ProductVariantPriceLoadingStrategy
 * @since 3.8.0
 */
export class DefaultProductVariantPriceLoadingStrategy implements ProductVariantPriceLoadingStrategy {
    readonly eagerLoading = true;
    private connection: TransactionalConnection;

    init(injector: Injector) {
        this.connection = injector.get(TransactionalConnection);
    }

    async loadPrices(ctx: RequestContext, variant: ProductVariant): Promise<ProductVariantPrice[]> {
        if (variant.productVariantPrices?.length) {
            return variant.productVariantPrices;
        }
        return this.connection
            .getRepository(ctx, ProductVariantPrice)
            .createQueryBuilder('price')
            .where('price.variant = :variantId', { variantId: variant.id })
            .getMany();
    }
}
