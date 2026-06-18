import { RequestContext } from '../../api/common/request-context';
import { PriceCalculationResult } from '../../common/types/common-types';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { ProductVariantPrice } from '../../entity/product-variant/product-variant-price.entity';
import { ProductVariant } from '../../entity/product-variant/product-variant.entity';
import { TaxCategory } from '../../entity/tax-category/tax-category.entity';
import { Zone } from '../../entity/zone/zone.entity';

/**
 * @description
 * Defines how ProductVariant are calculated based on the input price, tax zone and current request context.
 *
 * :::info
 *
 * This is configured via the `catalogOptions.productVariantPriceCalculationStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory  products & stock
 * @docsPage ProductVariantPriceCalculationStrategy
 */
export interface ProductVariantPriceCalculationStrategy extends InjectableStrategy {
    calculate(args: ProductVariantPriceCalculationArgs): Promise<PriceCalculationResult>;
}

/**
 * @description
 * The arguments passed the `calculate` method of the configured {@link ProductVariantPriceCalculationStrategy}.
 *
 * The `productVariant` argument was added in v2.1.0.
 *
 * @docsCategory products & stock
 * @docsPage ProductVariantPriceCalculationStrategy
 */
export interface ProductVariantPriceCalculationArgs {
    inputPrice: number;
    productVariantPrice?: ProductVariantPrice;
    productVariant: ProductVariant;
    taxCategory: TaxCategory;
    activeTaxZone: Zone;
    ctx: RequestContext;
}
