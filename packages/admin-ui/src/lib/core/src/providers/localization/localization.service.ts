import { Injectable } from '@angular/core';
import { Observable, map } from 'rxjs';

import { DataService } from '../../data/providers/data.service';
import { I18nService } from '../../providers/i18n/i18n.service';
import { LanguageCode } from '../../common/generated-types';

export type LocalizationDirectionType = Observable<'ltr' | 'rtl'>;
export type LocalizationLanguageCodeType = Observable<[LanguageCode, string | undefined]>;

/**
 * @description
 * Provides localization helper functionality.
 *
 */
@Injectable({
    providedIn: 'root',
})
export class LocalizationService {
    uiLanguageAndLocale$: LocalizationLanguageCodeType;
    direction$: LocalizationDirectionType;

    constructor(private i18nService: I18nService, private dataService: DataService) {
        this.uiLanguageAndLocale$ = this.dataService.client?.uiState()?.stream$?.pipe(
            map(({ uiState }) => {
                return [uiState.language, uiState.locale ?? undefined];
            }),
        );

        this.direction$ = this.uiLanguageAndLocale$?.pipe(
            map(([languageCode]) => {
                return this.i18nService.isRTL(languageCode) ? 'rtl' : 'ltr';
            }),
        );
    }
}
