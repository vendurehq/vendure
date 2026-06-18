import { Component, isDevMode, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { EMPTY, Observable } from 'rxjs';
import { map, switchMap, take } from 'rxjs/operators';

import { getAppConfig } from '../../app.config';
import { LanguageCode } from '../../common/generated-types';
import { ADMIN_UI_VERSION } from '../../common/version';
import { DataService } from '../../data/providers/data.service';
import { AuthService } from '../../providers/auth/auth.service';
import { BreadcrumbService } from '../../providers/breadcrumb/breadcrumb.service';
import { I18nService } from '../../providers/i18n/i18n.service';
import { LocalStorageService } from '../../providers/local-storage/local-storage.service';
import { ModalService } from '../../providers/modal/modal.service';
import { UiLanguageSwitcherDialogComponent } from '../ui-language-switcher-dialog/ui-language-switcher-dialog.component';
import {
    LocalizationDirectionType,
    LocalizationLanguageCodeType,
    LocalizationService,
} from '../../providers/localization/localization.service';

@Component({
    selector: 'vdr-app-shell',
    templateUrl: './app-shell.component.html',
    styleUrls: ['./app-shell.component.scss'],
    standalone: false,
})
export class AppShellComponent implements OnInit {
    version = ADMIN_UI_VERSION;
    userName$: Observable<string>;
    uiLanguageAndLocale$: LocalizationLanguageCodeType;
    direction$: LocalizationDirectionType;
    availableLanguages: LanguageCode[] = [];
    availableLocales: string[] = [];
    hideVendureBranding = getAppConfig().hideVendureBranding;
    hideVersion = getAppConfig().hideVersion;
    pageTitle$: Observable<string>;
    mainNavExpanded$: Observable<boolean>;
    devMode = isDevMode();

    constructor(
        private authService: AuthService,
        private dataService: DataService,
        private router: Router,
        private i18nService: I18nService,
        private modalService: ModalService,
        private localStorageService: LocalStorageService,
        private breadcrumbService: BreadcrumbService,
        private localizationService: LocalizationService,
    ) {}

    ngOnInit() {
        this.direction$ = this.localizationService.direction$;

        this.uiLanguageAndLocale$ = this.localizationService.uiLanguageAndLocale$;

        this.userName$ = this.dataService.client
            .userStatus()
            .single$.pipe(map(data => data.userStatus.username));

        this.availableLanguages = this.i18nService.availableLanguages;

        this.availableLocales = this.i18nService.availableLocales;

        this.pageTitle$ = this.breadcrumbService.breadcrumbs$.pipe(
            map(breadcrumbs => breadcrumbs[breadcrumbs.length - 1].label),
        );

        this.mainNavExpanded$ = this.dataService.client
            .uiState()
            .stream$.pipe(map(({ uiState }) => uiState.mainNavExpanded));
    }

    selectUiLanguage() {
        this.uiLanguageAndLocale$
            .pipe(
                take(1),
                switchMap(([currentLanguage, currentLocale]) => {
                    return this.modalService.fromComponent(UiLanguageSwitcherDialogComponent, {
                        closable: true,
                        size: 'lg',
                        locals: {
                            availableLocales: this.availableLocales,
                            availableLanguages: this.availableLanguages,
                            currentLanguage: currentLanguage,
                            currentLocale: currentLocale,
                        },
                    });
                }),
                switchMap(result =>
                    result ? this.dataService.client.setUiLanguage(result[0], result[1]) : EMPTY,
                ),
            )
            .subscribe(result => {
                if (result.setUiLanguage) {
                    this.i18nService.setLanguage(result.setUiLanguage);
                    this.localStorageService.set('uiLanguageCode', result.setUiLanguage);
                    this.localStorageService.set('uiLocale', result.setUiLocale ?? undefined);
                }
            });
    }

    expandNav() {
        this.dataService.client.setMainNavExpanded(true).subscribe();
    }

    collapseNav() {
        this.dataService.client.setMainNavExpanded(false).subscribe();
    }

    logOut() {
        this.authService.logOut().subscribe(() => {
            const { loginUrl } = getAppConfig();
            if (loginUrl) {
                window.location.href = loginUrl;
            } else {
                this.router.navigate(['/login']);
            }
        });
    }
}
