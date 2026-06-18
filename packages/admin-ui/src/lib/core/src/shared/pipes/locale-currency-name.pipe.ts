import { ChangeDetectorRef, Optional, Pipe, PipeTransform } from '@angular/core';

import { DataService } from '../../data/providers/data.service';

import { LocaleBasePipe } from './locale-base.pipe';

/**
 * @description
 * Displays a human-readable name for a given ISO 4217 currency code.
 *
 * @example
 * ```HTML
 * {{ order.currencyCode | localeCurrencyName }}
 * ```
 *
 * @docsCategory pipes
 */
@Pipe({
    name: 'localeCurrencyName',
    pure: false,
    standalone: false,
})
export class LocaleCurrencyNamePipe extends LocaleBasePipe implements PipeTransform {
    constructor(@Optional() dataService?: DataService, @Optional() changeDetectorRef?: ChangeDetectorRef) {
        super(dataService, changeDetectorRef);
    }
    transform(value: any, display: 'full' | 'symbol' | 'name' = 'full', locale?: unknown): any {
        if (value == null || value === '') {
            return '';
        }
        if (typeof value !== 'string') {
            return `Invalid currencyCode "${value as any}"`;
        }
        let name = '';
        let symbol = '';
        const activeLocale = this.getActiveLocale(locale);

        if (display === 'full' || display === 'name') {
            name =
                new Intl.DisplayNames([activeLocale], {
                    type: 'currency',
                }).of(value) ?? '';
        }
        if (display === 'full' || display === 'symbol') {
            const parts = (
                new Intl.NumberFormat(activeLocale, {
                    style: 'currency',
                    currency: value,
                    currencyDisplay: 'symbol',
                }) as any
            ).formatToParts();

            symbol = parts.find(p => p.type === 'currency')?.value || value;
        }
        return display === 'full' ? `${name} (${symbol})` : display === 'name' ? name : symbol;
    }
}
