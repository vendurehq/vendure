import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { UntypedFormControl } from '@angular/forms';
import { notNullOrUndefined } from '@vendure/common/lib/shared-utils';
import { combineLatest, Observable } from 'rxjs';
import { filter, map, startWith } from 'rxjs/operators';

import { CurrentUserChannel } from '../../common/generated-types';
import { DataService } from '../../data/providers/data.service';
import { ChannelService } from '../../providers/channel/channel.service';

@Component({
    selector: 'vdr-channel-switcher',
    templateUrl: './channel-switcher.component.html',
    styleUrls: ['./channel-switcher.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class ChannelSwitcherComponent implements OnInit {
    readonly displayFilterThreshold = 10;
    channels$: Observable<CurrentUserChannel[]>;
    channelCount$: Observable<number>;
    filterControl = new UntypedFormControl('');
    activeChannelCode$: Observable<string>;
    constructor(
        private dataService: DataService,
        private channelService: ChannelService,
    ) {}

    ngOnInit() {
        const channels$ = this.dataService.client.userStatus().mapStream(data => data.userStatus.channels);
        const filterTerm$ = this.filterControl.valueChanges.pipe<string>(startWith(''));
        this.channels$ = combineLatest(channels$, filterTerm$).pipe(
            map(([channels, filterTerm]) =>
                filterTerm
                    ? channels.filter(c =>
                          c.code.toLocaleLowerCase().includes(filterTerm.toLocaleLowerCase()),
                      )
                    : channels,
            ),
        );
        this.channelCount$ = channels$.pipe(map(channels => channels.length));
        const activeChannel$ = this.dataService.client
            .userStatus()
            .mapStream(data => data.userStatus.channels.find(c => c.id === data.userStatus.activeChannelId))
            .pipe(filter(notNullOrUndefined));
        this.activeChannelCode$ = activeChannel$.pipe(map(channel => channel.code));
    }

    setActiveChannel(channelId: string) {
        this.channelService.setActiveChannel(channelId).subscribe(() => this.filterControl.patchValue(''));
    }
}
