import { ChangeDetectorRef, Optional, Pipe, PipeTransform } from '@angular/core';

import { DataService } from '../../data/providers/data.service';

import { LocaleBasePipe } from './locale-base.pipe';

/**
 * @description
 * A replacement of the Angular DatePipe which makes use of the Intl API
 * to format dates according to the selected UI language.
 *
 * @example
 * ```HTML
 * {{ order.orderPlacedAt | localeDate }}
 * ```
 *
 * @docsCategory pipes
 */
@Pipe({
    name: 'localeDate',
    pure: false,
    standalone: false,
})
export class LocaleDatePipe extends LocaleBasePipe implements PipeTransform {
    constructor(@Optional() dataService?: DataService, @Optional() changeDetectorRef?: ChangeDetectorRef) {
        super(dataService, changeDetectorRef);
    }
    transform(value: unknown, ...args: unknown[]): unknown {
        const [format, locale] = args;
        if (this.locale || typeof locale === 'string') {
            const activeLocale = this.getActiveLocale(locale);
            const date =
                value instanceof Date ? value : typeof value === 'string' ? new Date(value) : undefined;
            if (date) {
                const options = this.getOptionsForFormat(typeof format === 'string' ? format : 'medium');
                return new Intl.DateTimeFormat(activeLocale, options).format(date);
            }
        }
    }

    private getOptionsForFormat(dateFormat: string): Intl.DateTimeFormatOptions | undefined {
        switch (dateFormat) {
            case 'medium':
                return {
                    month: 'short',
                    year: 'numeric',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: 'numeric',
                    second: 'numeric',
                };
            case 'mediumTime':
                return {
                    hour: 'numeric',
                    minute: 'numeric',
                    second: 'numeric',
                };
            case 'longDate':
                return {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                };
            case 'shortDate':
                return {
                    day: 'numeric',
                    month: 'numeric',
                    year: '2-digit',
                };
            case 'short':
                return {
                    day: 'numeric',
                    month: 'numeric',
                    year: '2-digit',
                    hour: 'numeric',
                    minute: 'numeric',
                };
            default:
                return;
        }
    }
}
