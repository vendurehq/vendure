import { Injector } from '../../common/injector';
import { roundMoney } from '../../common/round-money';
import { PriceCalculationResult } from '../../common/types/common-types';
import { idsAreEqual } from '../../common/utils';
import { TaxRate } from '../../entity/tax-rate/tax-rate.entity';
import { TaxRateService } from '../../service/services/tax-rate.service';

import {
    ProductVariantPriceCalculationArgs,
    ProductVariantPriceCalculationStrategy,
} from './product-variant-price-calculation-strategy';

/**
 * @description
 * A default ProductVariant price calculation function.
 *
 * When the Channel's prices include tax, an entered price includes the rate that
 * {@link TaxRateService} `findIncludedTaxRate()` returns: the country rate of the Channel's
 * `taxCountryCode` when it is set, otherwise the zone rate of its default tax Zone. The price is kept
 * as the gross price where that rate applies. Elsewhere the net price is taken out at the included
 * rate, and the applicable rate is then added to it. When the applicable rate and the included rate
 * have the same value and either one is a country rate, the entered price is kept as gross too, so
 * that rounding cannot move it by one unit. Two zone rates with the same value follow the v3
 * behaviour.
 *
 * If there is no included rate for the TaxCategory, the price is kept as gross in the default tax
 * Zone, and no tax is taken out elsewhere.
 *
 * @docsCategory products & stock
 */
export class DefaultProductVariantPriceCalculationStrategy implements ProductVariantPriceCalculationStrategy {
    private taxRateService: TaxRateService;

    init(injector: Injector) {
        this.taxRateService = injector.get(TaxRateService);
    }

    async calculate(args: ProductVariantPriceCalculationArgs): Promise<PriceCalculationResult> {
        const { inputPrice, activeTaxZone, ctx, taxCategory, taxRate } = args;
        let price = inputPrice;
        let priceIncludesTax = false;

        if (ctx.channel.pricesIncludeTax) {
            const includedRate = await this.taxRateService.findIncludedTaxRate(ctx, ctx.channel, taxCategory);
            const keepsGrossPrice =
                taxRate && includedRate
                    ? this.isSameTax(taxRate, includedRate)
                    : idsAreEqual(activeTaxZone.id, ctx.channel.defaultTaxZone.id);
            if (keepsGrossPrice) {
                priceIncludesTax = true;
            } else if (includedRate) {
                price = roundMoney(includedRate.netPriceOf(inputPrice));
            }
        }

        return {
            price,
            priceIncludesTax,
        };
    }

    /**
     * The applied rate is the included rate, or a rate of the same value where either one is a
     * country rate. The entered price is then already the right gross price, and taking the net out
     * and adding the same rate again could change it by one unit through rounding.
     */
    private isSameTax(taxRate: TaxRate, includedRate: TaxRate): boolean {
        return (
            idsAreEqual(taxRate.id, includedRate.id) ||
            ((taxRate.regionId != null || includedRate.regionId != null) &&
                taxRate.value === includedRate.value)
        );
    }
}
