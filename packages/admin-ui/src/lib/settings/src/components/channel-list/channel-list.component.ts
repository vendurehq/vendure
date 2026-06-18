import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { CHANNEL_FRAGMENT, GetChannelListDocument, TypedBaseListComponent } from '@vendure/admin-ui/core';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { gql } from 'apollo-angular';

export const GET_CHANNEL_LIST = gql`
    query GetChannelList($options: ChannelListOptions) {
        channels(options: $options) {
            items {
                ...Channel
            }
            totalItems
        }
    }
    ${CHANNEL_FRAGMENT}
`;

@Component({
    selector: 'vdr-channel-list',
    templateUrl: './channel-list.component.html',
    styleUrls: ['./channel-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ChannelListComponent
    extends TypedBaseListComponent<typeof GetChannelListDocument, 'channels'>
    implements OnInit
{
    dataTableListId = 'channel-list';
    readonly customFields = this.getCustomFieldConfig('Channel');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilter({
            name: 'code',
            type: { kind: 'text' },
            label: _('common.code'),
            filterField: 'code',
        })
        .addFilter({
            name: 'token',
            type: { kind: 'text' },
            label: _('settings.channel-token'),
            filterField: 'token',
        })
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .defaultSort('createdAt', 'DESC')
        .addSort({ name: 'createdAt' })
        .addSort({ name: 'updatedAt' })
        .addSort({ name: 'code' })
        .addSort({ name: 'token' })
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor() {
        super();
        super.configure({
            document: GetChannelListDocument,
            getItems: data => data.channels,
            setVariables: (skip, take) => ({
                options: {
                    skip,
                    take,
                    filter: {
                        code: {
                            contains: this.searchTermControl.value,
                        },
                        ...this.filters.createFilterInput(),
                    },
                    sort: this.sorts.createSortInput(),
                },
            }),
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });
    }

    isDefaultChannel(channelCode: string): boolean {
        return channelCode === DEFAULT_CHANNEL_CODE;
    }
}
