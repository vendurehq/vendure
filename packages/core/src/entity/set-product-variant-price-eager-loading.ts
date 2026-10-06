import { getMetadataArgsStorage } from 'typeorm';

import { ProductVariant } from './product-variant/product-variant.entity';

/**
 * `ProductVariant.productVariantPrices` is declared eager. A
 * {@link ProductVariantPriceLoadingStrategy} with `eagerLoading: false` loads the rows itself, so
 * the relation's metadata is changed before the DataSource is created, the same way the entity id
 * columns are typed in `setEntityIdStrategy()`.
 */
export function setProductVariantPriceEagerLoading(eager: boolean) {
    const relation = getMetadataArgsStorage().relations.find(
        r => r.target === ProductVariant && r.propertyName === 'productVariantPrices',
    );
    if (relation && relation.options.eager !== eager) {
        (relation as { options: typeof relation.options }).options = { ...relation.options, eager };
    }
}
