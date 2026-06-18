import { Injector } from '../../common/injector';
import { roundMoney } from '../../common/round-money';
import { PriceCalculationResult } from '../../common/types/common-types';
import { idsAreEqual } from '../../common/utils';
import { TaxRateService } from '../../service/services/tax-rate.service';

import {
    ProductVariantPriceCalculationArgs,
    ProductVariantPriceCalculationStrategy,
} from './product-variant-price-calculation-strategy';

/**
 * @description
 * A default ProductVariant price calculation function.
 *
 * @docsCategory products & stock
 */
export class DefaultProductVariantPriceCalculationStrategy implements ProductVariantPriceCalculationStrategy {
    private taxRateService: TaxRateService;

    init(injector: Injector) {
        this.taxRateService = injector.get(TaxRateService);
    }

    async calculate(args: ProductVariantPriceCalculationArgs): Promise<PriceCalculationResult> {
        const { inputPrice, activeTaxZone, ctx, taxCategory } = args;
        let price = inputPrice;
        let priceIncludesTax = false;

        if (ctx.channel.pricesIncludeTax) {
            const isDefaultZone = idsAreEqual(activeTaxZone.id, ctx.channel.defaultTaxZone.id);
            if (isDefaultZone) {
                priceIncludesTax = true;
            } else {
                const taxRateForDefaultZone = await this.taxRateService.getApplicableTaxRate(
                    ctx,
                    ctx.channel.defaultTaxZone,
                    taxCategory,
                );
                price = roundMoney(taxRateForDefaultZone.netPriceOf(inputPrice));
            }
        }

        return {
            price,
            priceIncludesTax,
        };
    }
}
