import { DOCUMENT } from '@angular/common';
import { Inject, Injectable } from '@angular/core';
import { TranslateService } from '@ngx-translate/core';

import { LanguageCode } from '../../common/generated-types';

/** @dynamic */
@Injectable({
    providedIn: 'root',
})
export class I18nService {
    _availableLocales: string[] = [];
    _availableLanguages: LanguageCode[] = [];

    get availableLanguages(): LanguageCode[] {
        return [...this._availableLanguages];
    }

    get availableLocales(): string[] {
        return [...this._availableLocales];
    }

    constructor(private ngxTranslate: TranslateService, @Inject(DOCUMENT) private document: Document) {}

    /**
     * Set the default language
     */
    setDefaultLanguage(languageCode: LanguageCode) {
        this.ngxTranslate.setDefaultLang(languageCode);
    }

    /**
     * Set the UI language
     */
    setLanguage(language: LanguageCode): void {
        this.ngxTranslate.use(language);
        if (this.document?.documentElement) {
            this.document.documentElement.lang = language;
        }
    }

    /**
     * Set the available UI languages
     */
    setAvailableLanguages(languages: LanguageCode[]) {
        this._availableLanguages = languages;
    }

    /**
     * Set the available UI locales
     */
    setAvailableLocales(locales: string[]) {
        this._availableLocales = locales;
    }

    /**
     * Translate the given key.
     */
    translate(key: string | string[], params?: any): string {
        return this.ngxTranslate.instant(key, params);
    }

    /**
     * Returns true if the given language code is a right-to-left language.
     */
    isRTL(languageCode: LanguageCode): boolean {
        const rtlLanguageCodes = [
            LanguageCode.ar,
            LanguageCode.he,
            LanguageCode.fa,
            LanguageCode.ur,
            LanguageCode.ps,
        ];
        return rtlLanguageCodes.includes(languageCode);
    }
}
