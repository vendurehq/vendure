import { ChangeDetectionStrategy, Component, Input } from '@angular/core';
import {
    CurrencyCode,
    ProductVariantDetailQueryProductVariantFragmentFragment,
} from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-variant-price-strategy-detail',
    templateUrl: './variant-price-strategy-detail.component.html',
    styleUrls: ['./variant-price-strategy-detail.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class VariantPriceStrategyDetailComponent {
    @Input() channelPriceIncludesTax: boolean;
    @Input() variant: ProductVariantDetailQueryProductVariantFragmentFragment;
    @Input() channelDefaultCurrencyCode: CurrencyCode;

    calculatedPriceDiffersFromInputPrice(): boolean {
        const defaultPrice =
            this.variant.prices.find(p => p.currencyCode === this.channelDefaultCurrencyCode) ??
            this.variant.prices[0];
        if (!defaultPrice) {
            return false;
        }
        if (this.channelPriceIncludesTax) {
            return this.variant.priceWithTax !== defaultPrice.price;
        } else {
            return this.variant.price !== defaultPrice.price;
        }
    }
}
