import { ChangeDetectionStrategy, Component, OnInit, ViewChild } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataService,
    GetZoneListDocument,
    GetZoneListQuery,
    ItemOf,
    LanguageCode,
    LogicalOperator,
    ModalService,
    NotificationService,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { combineLatest, EMPTY, Observable } from 'rxjs';
import { distinctUntilChanged, map, mapTo, switchMap, tap } from 'rxjs/operators';

import { AddCountryToZoneDialogComponent } from '../add-country-to-zone-dialog/add-country-to-zone-dialog.component';
import { ZoneMemberListComponent } from '../zone-member-list/zone-member-list.component';

export const GET_ZONE_LIST = gql`
    query GetZoneList($options: ZoneListOptions) {
        zones(options: $options) {
            items {
                ...ZoneListItem
            }
            totalItems
        }
    }
    fragment ZoneListItem on Zone {
        id
        createdAt
        updatedAt
        name
    }
`;

@Component({
    selector: 'vdr-zone-list',
    templateUrl: './zone-list.component.html',
    styleUrls: ['./zone-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ZoneListComponent
    extends TypedBaseListComponent<typeof GetZoneListDocument, 'zones'>
    implements OnInit
{
    dataTableListId = 'zone-list';
    activeZone$: Observable<ItemOf<GetZoneListQuery, 'zones'> | undefined>;
    activeIndex$: Observable<number>;
    selectedMemberIds: string[] = [];
    @ViewChild(ZoneMemberListComponent) zoneMemberList: ZoneMemberListComponent;
    readonly customFields = this.serverConfigService.getCustomFieldsFor('Zone');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilter({
            name: 'name',
            type: { kind: 'text' },
            label: _('common.name'),
            filterField: 'name',
        })
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .defaultSort('createdAt', 'DESC')
        .addSort({ name: 'createdAt' })
        .addSort({ name: 'updatedAt' })
        .addSort({ name: 'name' })
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor(
        protected dataService: DataService,
        private notificationService: NotificationService,
        private modalService: ModalService,
    ) {
        super();
        super.configure({
            document: GetZoneListDocument,
            getItems: data => data.zones,
            setVariables: (skip, take) => ({
                options: {
                    skip,
                    take,
                    filter: {
                        name: {
                            contains: this.searchTermControl.value,
                        },
                        ...this.filters.createFilterInput(),
                    },
                    filterOperator: this.searchTermControl.value ? LogicalOperator.OR : LogicalOperator.AND,
                    sort: this.sorts.createSortInput(),
                },
            }),
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });
    }

    ngOnInit(): void {
        super.ngOnInit();
        const activeZoneId$ = this.route.paramMap.pipe(
            map(pm => pm.get('contents')),
            distinctUntilChanged(),
            tap(() => (this.selectedMemberIds = [])),
        );
        this.activeZone$ = combineLatest(this.items$, activeZoneId$).pipe(
            map(([zones, activeZoneId]) => {
                if (activeZoneId) {
                    return zones.find(z => z.id === activeZoneId);
                }
            }),
        );
        this.activeIndex$ = combineLatest(this.items$, activeZoneId$).pipe(
            map(([zones, activeZoneId]) => {
                if (activeZoneId) {
                    return zones.findIndex(g => g.id === activeZoneId);
                } else {
                    return -1;
                }
            }),
        );
    }

    setLanguage(code: LanguageCode) {
        this.dataService.client.setContentLanguage(code).subscribe();
    }

    closeMembers() {
        const params = { ...this.route.snapshot.params };
        delete params.contents;
        this.router.navigate(['./', params], { relativeTo: this.route, queryParamsHandling: 'preserve' });
    }

    addToZone(zone: ItemOf<GetZoneListQuery, 'zones'>) {
        this.modalService
            .fromComponent(AddCountryToZoneDialogComponent, {
                locals: {
                    zoneName: zone.name,
                    zoneId: zone.id,
                },
                size: 'md',
            })
            .pipe(
                switchMap(memberIds =>
                    memberIds
                        ? this.dataService.settings
                              .addMembersToZone(zone.id, memberIds)
                              .pipe(mapTo(memberIds))
                        : EMPTY,
                ),
            )
            .subscribe({
                next: result => {
                    this.notificationService.success(_(`settings.add-countries-to-zone-success`), {
                        countryCount: result.length,
                        zoneName: zone.name,
                    });
                    this.refreshMemberList();
                },
                error: err => {
                    this.notificationService.error(err);
                },
            });
    }

    refreshMemberList() {
        this.zoneMemberList?.refresh();
    }
}
