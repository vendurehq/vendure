import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { combineLatest } from 'rxjs';
import { ItemOf } from '../../../common/base-list.component';
import { GetChannelsQuery } from '../../../common/generated-types';
import { DataService } from '../../../data/providers/data.service';
import { Dialog } from '../../../providers/modal/modal.types';
import { NotificationService } from '../../../providers/notification/notification.service';

type Channel = ItemOf<GetChannelsQuery, 'channels'>;

@Component({
    selector: 'vdr-assign-to-channel-dialog',
    templateUrl: './assign-to-channel-dialog.component.html',
    styleUrls: ['./assign-to-channel-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class AssignToChannelDialogComponent implements OnInit, Dialog<Channel[]> {
    selectedChannels: Channel[] = [];

    currentChannel: Channel;
    availableChannels: Channel[];
    resolveWith: (result?: Channel[]) => void;
    selectedChannelIdControl = new UntypedFormControl();

    itemNames: string;
    nMore: number;

    constructor(
        private dataService: DataService,
        private notificationService: NotificationService,
    ) {}

    ngOnInit() {
        const activeChannelId$ = this.dataService.client
            .userStatus()
            .mapSingle(({ userStatus }) => userStatus.activeChannelId);
        const allChannels$ = this.dataService.settings.getChannels().mapSingle(data => data.channels);

        combineLatest(activeChannelId$, allChannels$).subscribe(([activeChannelId, channels]) => {
            // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
            this.currentChannel = channels.items.find(c => c.id === activeChannelId)!;
            this.availableChannels = channels.items;
        });

        this.selectedChannelIdControl.valueChanges.subscribe(ids => {
            this.selectChannel(ids);
        });
    }

    selectChannel(channelIds: string[]) {
        this.selectedChannels = this.availableChannels.filter(c => channelIds.includes(c.id));
    }

    assign() {
        const selectedChannels = this.selectedChannels;
        if (selectedChannels.length > 0) {
            this.resolveWith(selectedChannels);
        }
    }

    cancel() {
        this.resolveWith();
    }
}
