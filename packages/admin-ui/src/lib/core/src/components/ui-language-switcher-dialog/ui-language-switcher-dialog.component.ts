import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';

import { Subject, finalize, take, takeUntil } from 'rxjs';
import { CurrencyCode, LanguageCode } from '../../common/generated-types';
import { Dialog } from '../../providers/modal/modal.types';
import { DataService } from '../../data/providers/data.service';
import { getAppConfig } from '../../app.config';

@Component({
    selector: 'vdr-ui-language-switcher',
    templateUrl: './ui-language-switcher-dialog.component.html',
    styleUrls: ['./ui-language-switcher-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class UiLanguageSwitcherDialogComponent
    implements Dialog<[LanguageCode, string | undefined]>, OnInit, OnDestroy
{
    isLoading = true;
    private destroy$ = new Subject<void>();
    resolveWith: (result?: [LanguageCode, string | undefined]) => void;
    currentLanguage: LanguageCode;
    availableLanguages: LanguageCode[] = [];
    currentLocale: string | undefined;
    availableLocales: string[] = [];
    availableCurrencyCodes = Object.values(CurrencyCode);
    selectedCurrencyCode: string;
    previewLocale: string;
    readonly browserDefaultLocale: string | undefined;
    readonly now = new Date().toISOString();

    constructor(
        private dataService: DataService,
        private changeDetector: ChangeDetectorRef,
    ) {
        const browserLanguage = navigator.language.split('-');
        this.browserDefaultLocale = browserLanguage.length === 1 ? undefined : browserLanguage[1];
    }

    ngOnInit() {
        this.updatePreviewLocale();

        this.dataService.settings
            .getActiveChannel()
            .mapStream(data => data.activeChannel.defaultCurrencyCode)
            .pipe(
                take(1),
                takeUntil(this.destroy$),
                finalize(() => {
                    this.isLoading = false;
                    this.changeDetector.markForCheck();
                }),
            )
            .subscribe(x => {
                this.selectedCurrencyCode = x;
            });
    }

    ngOnDestroy(): void {
        this.destroy$.next();
        this.destroy$.complete();
    }

    updatePreviewLocale() {
        if (!this.currentLocale || this.currentLocale.length === 0 || this.currentLocale.length === 2) {
            this.previewLocale = this.createLocaleString(this.currentLanguage, this.currentLocale);
        }
    }

    setLanguage() {
        this.resolveWith([this.currentLanguage, this.currentLocale?.toUpperCase()]);
    }

    cancel() {
        this.resolveWith();
    }

    private createLocaleString(languageCode: LanguageCode, region?: string | null): string {
        if (!region) {
            return languageCode;
        }
        return [languageCode, region.toUpperCase()].join('-');
    }
}
