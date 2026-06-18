import { PlatformLocation } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { NgModule } from '@angular/core';
import { BrowserModule, Title } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { TranslateCompiler, TranslateLoader, TranslateModule } from '@ngx-translate/core';
import { interval } from 'rxjs';

import { getAppConfig } from './app.config';
import { getDefaultUiLanguage, getDefaultUiLocale } from './common/utilities/get-default-ui-language';
import { AlertsComponent } from './components/alerts/alerts.component';
import { AppShellComponent } from './components/app-shell/app-shell.component';
import { BaseNavComponent } from './components/base-nav/base-nav.component';
import { BreadcrumbComponent } from './components/breadcrumb/breadcrumb.component';
import { ChannelSwitcherComponent } from './components/channel-switcher/channel-switcher.component';
import { MainNavComponent } from './components/main-nav/main-nav.component';
import { NotificationComponent } from './components/notification/notification.component';
import { OverlayHostComponent } from './components/overlay-host/overlay-host.component';
import { SettingsNavComponent } from './components/settings-nav/settings-nav.component';
import { ThemeSwitcherComponent } from './components/theme-switcher/theme-switcher.component';
import { UiLanguageSwitcherDialogComponent } from './components/ui-language-switcher-dialog/ui-language-switcher-dialog.component';
import { UserMenuComponent } from './components/user-menu/user-menu.component';
import { DataModule } from './data/data.module';
import { AlertsService } from './providers/alerts/alerts.service';
import { CustomHttpTranslationLoader } from './providers/i18n/custom-http-loader';
import { InjectableTranslateMessageFormatCompiler } from './providers/i18n/custom-message-format-compiler';
import { I18nService } from './providers/i18n/i18n.service';
import { LocalStorageService } from './providers/local-storage/local-storage.service';
import { Permission } from './public_api';
import { registerDefaultFormInputs } from './shared/dynamic-form-inputs/default-form-inputs';
import { SharedModule } from './shared/shared.module';

@NgModule({
    imports: [
        BrowserModule,
        DataModule,
        SharedModule,
        BrowserAnimationsModule,
        TranslateModule.forRoot({
            loader: {
                provide: TranslateLoader,
                useFactory: HttpLoaderFactory,
                deps: [HttpClient, PlatformLocation],
            },

            compiler: { provide: TranslateCompiler, useClass: InjectableTranslateMessageFormatCompiler },
        }),
    ],
    providers: [registerDefaultFormInputs(), Title],
    exports: [SharedModule, OverlayHostComponent],
    declarations: [
        AppShellComponent,
        UserMenuComponent,
        BaseNavComponent,
        MainNavComponent,
        SettingsNavComponent,
        BreadcrumbComponent,
        OverlayHostComponent,
        NotificationComponent,
        UiLanguageSwitcherDialogComponent,
        ChannelSwitcherComponent,
        ThemeSwitcherComponent,
        AlertsComponent,
    ],
})
export class CoreModule {
    constructor(
        private i18nService: I18nService,
        private localStorageService: LocalStorageService,
        private titleService: Title,
        private alertsService: AlertsService,
    ) {
        this.initUiLanguagesAndLocales();
        this.initUiTitle();
        this.initAlerts();
    }

    private initUiLanguagesAndLocales() {
        const defaultLanguage = getDefaultUiLanguage();
        const defaultLocale = getDefaultUiLocale();

        const lastLanguage = this.localStorageService.get('uiLanguageCode');
        const availableLanguages = getAppConfig().availableLanguages;
        const availableLocales = getAppConfig().availableLocales ?? [defaultLocale];

        if (!!defaultLanguage && !availableLanguages.includes(defaultLanguage)) {
            throw new Error(
                `The defaultLanguage "${defaultLanguage}" must be one of the availableLanguages [${availableLanguages
                    .map(l => `"${l}"`)
                    .join(', ')}]`,
            );
        }

        const uiLanguage =
            lastLanguage && availableLanguages.includes(lastLanguage) ? lastLanguage : defaultLanguage;

        // The locale detected from the `navigator.language` API might not be one of the
        // "available" locales. In this case, we should still allow the app to load
        // and add the detected locale to the available options.
        if (defaultLocale && !availableLocales.includes(defaultLocale)) {
            console.info(`Adding default locale ${defaultLocale} to the list of available locales`);
            availableLocales.unshift(defaultLocale);
        }

        this.localStorageService.set('uiLanguageCode', uiLanguage);

        this.i18nService.setLanguage(uiLanguage);
        this.i18nService.setDefaultLanguage(defaultLanguage);
        this.i18nService.setAvailableLanguages(availableLanguages || [defaultLanguage]);
        this.i18nService.setAvailableLocales(availableLocales || [defaultLocale]);
    }

    private initUiTitle() {
        const title = getAppConfig().brand || 'Vendure';

        this.titleService.setTitle(title);
    }

    private initAlerts() {
        const pendingUpdatesId = 'pending-search-index-updates';
        this.alertsService.configureAlert({
            id: pendingUpdatesId,
            requiredPermissions: [Permission.ReadCatalog, Permission.ReadProduct],
            check: context =>
                context.dataService.product
                    .getPendingSearchIndexUpdates()
                    .mapSingle(({ pendingSearchIndexUpdates }) => pendingSearchIndexUpdates),
            recheck: () => interval(1000 * 30),
            isAlert: data => 0 < data,
            action: (data, context) => {
                context.dataService.product.runPendingSearchIndexUpdates().subscribe(() => {
                    context.notificationService.info(_('catalog.running-search-index-updates'), {
                        count: data,
                    });
                });
            },
            label: data => ({
                text: _('catalog.run-pending-search-index-updates'),
                translationVars: { count: data },
            }),
        });
        this.alertsService.refresh(pendingUpdatesId);
    }
}

export function HttpLoaderFactory(http: HttpClient, location: PlatformLocation) {
    // Dynamically get the baseHref, which is configured in the angular.json file
    const baseHref = location.getBaseHrefFromDOM();
    return new CustomHttpTranslationLoader(http, baseHref + 'i18n-messages/');
}
