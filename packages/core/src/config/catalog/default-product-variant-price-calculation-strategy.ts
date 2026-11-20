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
 * When the Channel's prices include tax, an entered price includes the tax rate of the Channel's
 * default tax Zone. It is kept as the gross price where that rate applies. Elsewhere the net price is
 * taken out at the default Zone's rate, and the applicable rate is then added to it. With
 * {@link ProductVariantPriceCalculationArgs} `taxRate`, a country rate is treated like the rate of
 * another Zone, as if the country had its own Zone. A country rate with the same value as the
 * default Zone's rate keeps the entered price as gross.
 *
 * If the default tax Zone has no zone rate for the TaxCategory, the price is kept as gross in the
 * default Zone, and no tax is taken out elsewhere.
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
            // Looked up by Zone only, so this is the default Zone's own zone rate, or the 0% default.
            const taxRateForDefaultZone = await this.taxRateService.getApplicableTaxRate(
                ctx,
                ctx.channel.defaultTaxZone,
                taxCategory,
            );
            const defaultZoneHasZoneRate = taxRateForDefaultZone.zoneId != null;
            const keepsGrossPrice =
                taxRate && defaultZoneHasZoneRate
                    ? this.isSameTax(taxRate, taxRateForDefaultZone)
                    : idsAreEqual(activeTaxZone.id, ctx.channel.defaultTaxZone.id);
            if (keepsGrossPrice) {
                priceIncludesTax = true;
            } else {
                price = roundMoney(taxRateForDefaultZone.netPriceOf(inputPrice));
            }
        }

        return {
            price,
            priceIncludesTax,
        };
    }

    /**
     * A country rate with the default Zone's value is the same tax, so the entered price is already
     * the right gross price. Taking the net out and adding the same rate again could change it by one
     * unit through rounding.
     */
    private isSameTax(taxRate: TaxRate, taxRateForDefaultZone: TaxRate): boolean {
        return (
            idsAreEqual(taxRate.id, taxRateForDefaultZone.id) ||
            (taxRate.regionId != null && taxRate.value === taxRateForDefaultZone.value)
        );
    }
}
