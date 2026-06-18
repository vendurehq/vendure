import { DOCUMENT } from '@angular/common';
import { Component, HostListener, Inject, isDevMode, OnInit } from '@angular/core';
import { Observable } from 'rxjs';
import { filter, map, switchMap } from 'rxjs/operators';

import { DataService } from './data/providers/data.service';
import { ServerConfigService } from './data/server-config';
import { LocalStorageService } from './providers/local-storage/local-storage.service';

@Component({
    selector: 'vdr-root',
    templateUrl: './app.component.html',
    styleUrls: ['./app.component.scss'],
    standalone: false,
})
export class AppComponent implements OnInit {
    loading$: Observable<boolean>;
    private _document?: Document;

    constructor(
        private dataService: DataService,
        private serverConfigService: ServerConfigService,
        private localStorageService: LocalStorageService,
        @Inject(DOCUMENT) private document?: any,
    ) {
        this._document = document;
    }

    ngOnInit() {
        this.loading$ = this.dataService.client
            .getNetworkStatus()
            .stream$.pipe(map(data => 0 < data.networkStatus.inFlightRequests));

        this.dataService.client
            .uiState()
            .mapStream(data => data.uiState.theme)
            .subscribe(theme => {
                this._document?.body.setAttribute('data-theme', theme);
                this._document?.body.setAttribute('cds-theme', theme === 'dark' ? 'dark' : 'light');
            });

        // Once logged in, keep the localStorage "contentLanguageCode" in sync with the
        // uiState. Also perform a check to ensure that the current contentLanguage is
        // one of the availableLanguages per GlobalSettings.
        this.dataService.client
            .userStatus()
            .mapStream(({ userStatus }) => userStatus.isLoggedIn)
            .pipe(
                filter(loggedIn => loggedIn === true),
                switchMap(() =>
                    this.dataService.client.uiState().mapStream(data => data.uiState.contentLanguage),
                ),
                switchMap(contentLang =>
                    this.serverConfigService
                        .getAvailableLanguages()
                        .pipe(map(available => [contentLang, available] as const)),
                ),
            )
            .subscribe({
                next: ([contentLanguage, availableLanguages]) => {
                    this.localStorageService.set('contentLanguageCode', contentLanguage);
                    if (availableLanguages.length && !availableLanguages.includes(contentLanguage)) {
                        this.dataService.client.setContentLanguage(availableLanguages[0]).subscribe();
                    }
                },
            });

        this.dataService.client.userStatus().stream$.subscribe(({ userStatus }) => {
            this.localStorageService.setAdminId(userStatus.administratorId);

            if (userStatus.administratorId) {
                const theme = this.localStorageService.get('activeTheme');
                if (theme) {
                    this.dataService.client.setUiTheme(theme).subscribe(() => {
                        this.localStorageService.set('activeTheme', theme);
                    });
                }
                const activeChannelToken = this.localStorageService.get('activeChannelToken');
                if (activeChannelToken) {
                    const activeChannel = userStatus.channels.find(c => c.token === activeChannelToken);
                    if (activeChannel) {
                        this.dataService.client.setActiveChannel(activeChannel.id).subscribe();
                    }
                }
            }
        });

        if (isDevMode()) {
            // eslint-disable-next-line no-console
            console.log(
                `%cVendure Admin UI: Press "ctrl/cmd + u" to view UI extension points`,
                `color: #17C1FF; font-weight: bold;`,
            );
        }
    }

    @HostListener('window:keydown', ['$event'])
    handleGlobalHotkeys(event: KeyboardEvent) {
        if ((event.ctrlKey === true || event.metaKey === true) && event.key === 'u') {
            event.preventDefault();
            if (isDevMode()) {
                this.dataService.client
                    .uiState()
                    .single$.pipe(
                        switchMap(({ uiState }) =>
                            this.dataService.client.setDisplayUiExtensionPoints(
                                !uiState.displayUiExtensionPoints,
                            ),
                        ),
                    )
                    .subscribe();
            }
        }
    }
}
