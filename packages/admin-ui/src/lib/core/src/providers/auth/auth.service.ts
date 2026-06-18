import { Injectable } from '@angular/core';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { Observable, of } from 'rxjs';
import { catchError, map, mergeMap, switchMap, tap } from 'rxjs/operators';

import { AttemptLoginMutation, CurrentUserFragment } from '../../common/generated-types';
import { DataService } from '../../data/providers/data.service';
import { ServerConfigService } from '../../data/server-config';
import { LocalStorageService } from '../local-storage/local-storage.service';
import { PermissionsService } from '../permissions/permissions.service';
import { AlertsService } from '../alerts/alerts.service';

/**
 * This service handles logic relating to authentication of the current user.
 */
@Injectable({
    providedIn: 'root',
})
export class AuthService {
    constructor(
        private localStorageService: LocalStorageService,
        private dataService: DataService,
        private serverConfigService: ServerConfigService,
        private permissionsService: PermissionsService,
        private alertService: AlertsService,
    ) {}

    /**
     * Attempts to log in via the REST login endpoint and updates the app
     * state on success.
     */
    logIn(
        username: string,
        password: string,
        rememberMe: boolean,
    ): Observable<AttemptLoginMutation['login']> {
        return this.dataService.auth.attemptLogin(username, password, rememberMe).pipe(
            switchMap(response => {
                if (response.login.__typename === 'CurrentUser') {
                    this.setChannelToken(response.login.channels);
                }
                return this.serverConfigService.getServerConfig().then(() => response.login);
            }),
            switchMap(login => {
                if (login.__typename === 'CurrentUser') {
                    const activeChannel = this.getActiveChannel(login.channels);
                    this.permissionsService.setCurrentUserPermissions(activeChannel.permissions);
                    return this.dataService.administrator.getActiveAdministrator().single$.pipe(
                        switchMap(({ activeAdministrator }) => {
                            if (activeAdministrator) {
                                return this.dataService.client
                                    .loginSuccess(
                                        activeAdministrator.id,
                                        `${activeAdministrator.firstName} ${activeAdministrator.lastName}`,
                                        activeChannel.id,
                                        login.channels,
                                    )
                                    .pipe(map(() => login));
                            } else {
                                return of(login);
                            }
                        }),
                    );
                }
                return of(login);
            }),
        );
    }

    /**
     * Update the user status to being logged out.
     */
    logOut(): Observable<boolean> {
        return this.dataService.client.userStatus().single$.pipe(
            switchMap(status => {
                if (status.userStatus.isLoggedIn) {
                    return this.dataService.client
                        .logOut()
                        .pipe(mergeMap(() => this.dataService.auth.logOut()));
                } else {
                    return [];
                }
            }),
            tap(() => {
                this.alertService.clearAlerts();
            }),
            map(() => true),
        );
    }

    /**
     * Checks the app state to see if the user is already logged in,
     * and if not, attempts to validate any auth token found.
     */
    checkAuthenticatedStatus(): Observable<boolean> {
        return this.dataService.client.userStatus().single$.pipe(
            mergeMap(data => {
                if (!data.userStatus.isLoggedIn) {
                    return this.validateAuthToken();
                } else {
                    return of(true);
                }
            }),
        );
    }

    /**
     * Checks for an auth token and if found, attempts to validate
     * that token against the API.
     */
    validateAuthToken(): Observable<boolean> {
        return this.dataService.auth.currentUser().single$.pipe(
            mergeMap(({ me }) => {
                if (!me) {
                    return of(false) as any;
                }
                this.setChannelToken(me.channels);
                const activeChannel = this.getActiveChannel(me.channels);
                this.permissionsService.setCurrentUserPermissions(activeChannel.permissions);
                return this.dataService.administrator.getActiveAdministrator().single$.pipe(
                    switchMap(({ activeAdministrator }) => {
                        if (activeAdministrator) {
                            return this.dataService.client
                                .loginSuccess(
                                    activeAdministrator.id,
                                    `${activeAdministrator.firstName} ${activeAdministrator.lastName}`,
                                    activeChannel.id,
                                    me.channels,
                                )
                                .pipe(map(() => true));
                        } else {
                            return of(false);
                        }
                    }),
                );
            }),
            map(() => true),
            catchError(err => of(false)),
        );
    }

    private getActiveChannel(userChannels: CurrentUserFragment['channels']) {
        const lastActiveChannelToken = this.localStorageService.get('activeChannelToken');
        if (lastActiveChannelToken) {
            const lastActiveChannel = userChannels.find(c => c.token === lastActiveChannelToken);
            if (lastActiveChannel) {
                return lastActiveChannel;
            }
        }
        const defaultChannel = userChannels.find(c => c.code === DEFAULT_CHANNEL_CODE);
        return defaultChannel || userChannels[0];
    }

    private setChannelToken(userChannels: CurrentUserFragment['channels']) {
        this.localStorageService.set('activeChannelToken', this.getActiveChannel(userChannels).token);
    }
}
