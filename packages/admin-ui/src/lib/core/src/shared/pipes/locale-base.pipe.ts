import { ChangeDetectorRef, Injectable, OnDestroy, PipeTransform } from '@angular/core';
import { Subscription } from 'rxjs';

import { DataService } from '../../data/providers/data.service';

/**
 * Used by locale-aware pipes to handle the task of getting the active languageCode
 * of the UI and cleaning up.
 */
@Injectable()
export abstract class LocaleBasePipe implements OnDestroy, PipeTransform {
    protected locale: string;
    private readonly subscription: Subscription;

    protected constructor(dataService?: DataService, changeDetectorRef?: ChangeDetectorRef) {
        if (dataService && changeDetectorRef) {
            this.subscription = dataService.client
                .uiState()
                .mapStream(data => data.uiState)
                .subscribe(({ language, locale }) => {
                    this.locale = language.replace(/_/g, '-');
                    if (locale && !this.locale.includes('-')) {
                        this.locale += `-${locale}`;
                    }
                    changeDetectorRef.markForCheck();
                });
        }
    }

    ngOnDestroy() {
        if (this.subscription) {
            this.subscription.unsubscribe();
        }
    }

    /**
     * Returns the active locale after attempting to ensure that the locale string
     * is valid for the Intl API.
     */
    protected getActiveLocale(localeOverride?: unknown): string {
        const locale = typeof localeOverride === 'string' ? localeOverride : (this.locale ?? 'en');
        const hyphenated = locale?.replace(/_/g, '-');

        // Check for a double-region string, containing 2 region codes like
        // pt-BR-BR, which is invalid. In this case, the second region is used
        // and the first region discarded. This would only ever be an issue for
        // those languages where the translation file itself encodes the region,
        // as in pt_BR & pt_PT.
        const matches = hyphenated?.match(/^([a-zA-Z_-]+)(-[A-Z][A-Z])(-[A-Z][A-Z])$/);
        if (matches?.length) {
            const overriddenLocale = matches[1] + matches[3];
            return overriddenLocale;
        } else {
            return hyphenated;
        }
    }

    /* eslint-disable @typescript-eslint/no-explicit-any */
    abstract transform(value: any, ...args): any;
}
