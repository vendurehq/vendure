import { ChangeDetectorRef, Optional, Pipe, PipeTransform } from '@angular/core';

import { DataService } from '../../data/providers/data.service';
import { CurrencyService } from '../../providers/currency/currency.service';

import { LocaleBasePipe } from './locale-base.pipe';

/**
 * @description
 * Formats a Vendure monetary value (in cents) into the correct format for the configured currency and display
 * locale.
 *
 * @example
 * ```HTML
 * {{ variant.priceWithTax | localeCurrency }}
 * ```
 *
 * @docsCategory pipes
 */
@Pipe({
    name: 'localeCurrency',
    pure: false,
    standalone: false,
})
export class LocaleCurrencyPipe extends LocaleBasePipe implements PipeTransform {
    readonly precisionFactor: number;
    constructor(
        private currencyService: CurrencyService,
        @Optional() dataService?: DataService,
        @Optional() changeDetectorRef?: ChangeDetectorRef,
    ) {
        super(dataService, changeDetectorRef);
    }

    transform(value: unknown, ...args: unknown[]): string | unknown {
        const [currencyCode, locale] = args;
        if (typeof value === 'number') {
            const activeLocale = this.getActiveLocale(locale);
            const majorUnits = this.currencyService.toMajorUnits(value);
            try {
                return new Intl.NumberFormat(activeLocale, {
                    style: 'currency',
                    currency: currencyCode as any,
                    minimumFractionDigits: this.currencyService.precision,
                    maximumFractionDigits: this.currencyService.precision,
                }).format(majorUnits);
            } catch (e: any) {
                return majorUnits.toFixed(this.currencyService.precision);
            }
        }
        return value;
    }
}
