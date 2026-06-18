import { Injectable } from '@angular/core';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { Observable } from 'rxjs';
import { map, shareReplay, tap } from 'rxjs/operators';

import { UserStatusFragment } from '../../common/generated-types';
import { DataService } from '../../data/providers/data.service';
import { LocalStorageService } from '../local-storage/local-storage.service';
import { PermissionsService } from '../permissions/permissions.service';

@Injectable({
    providedIn: 'root',
})
export class ChannelService {
    defaultChannelIsActive$: Observable<boolean>;

    constructor(
        private dataService: DataService,
        private localStorageService: LocalStorageService,
        private permissionsService: PermissionsService,
    ) {
        this.defaultChannelIsActive$ = this.dataService.client
            .userStatus()
            .mapStream(({ userStatus }) => {
                const activeChannel = userStatus.channels.find(c => c.id === userStatus.activeChannelId);
                return activeChannel ? activeChannel.code === DEFAULT_CHANNEL_CODE : false;
            })
            .pipe(shareReplay(1));
    }

    setActiveChannel(channelId: string): Observable<UserStatusFragment> {
        return this.dataService.client.setActiveChannel(channelId).pipe(
            map(({ setActiveChannel }) => setActiveChannel),
            tap(userStatus => {
                const activeChannel = userStatus.channels.find(c => c.id === channelId);
                if (activeChannel) {
                    this.localStorageService.set('activeChannelToken', activeChannel.token);
                    this.permissionsService.setCurrentUserPermissions(activeChannel.permissions);
                }
            }),
        );
    }
}
