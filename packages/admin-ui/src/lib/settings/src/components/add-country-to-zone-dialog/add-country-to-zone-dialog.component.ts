import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import {
    DataService,
    Dialog,
    GetCountryListDocument,
    GetCountryListQuery,
    GetZoneListQuery,
    GetZoneMembersDocument,
    GetZoneMembersQuery,
    ItemOf,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { Observable } from 'rxjs';
import { map, withLatestFrom } from 'rxjs/operators';

export const GET_ZONE_MEMBERS = gql`
    query GetZoneMembers($zoneId: ID!) {
        zone(id: $zoneId) {
            id
            createdAt
            updatedAt
            name
            members {
                createdAt
                updatedAt
                id
                name
                code
                enabled
            }
        }
    }
`;

@Component({
    selector: 'vdr-add-country-to-zone-dialog',
    templateUrl: './add-country-to-zone-dialog.component.html',
    styleUrls: ['./add-country-to-zone-dialog.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class AddCountryToZoneDialogComponent implements Dialog<string[]>, OnInit {
    resolveWith: (result?: string[]) => void;
    zoneName: string;
    zoneId: string;
    currentMembers$: Observable<NonNullable<GetZoneMembersQuery['zone']>['members']>;
    availableCountries$: Observable<Array<ItemOf<GetCountryListQuery, 'countries'>>>;
    selectedMemberIds: string[] = [];

    constructor(private dataService: DataService) {}

    ngOnInit(): void {
        this.currentMembers$ = this.dataService
            .query(GetZoneMembersDocument, { zoneId: this.zoneId })
            .mapSingle(({ zone }) => zone?.members ?? []);
        this.availableCountries$ = this.dataService
            .query(GetCountryListDocument, {
                options: { take: 999 },
            })
            .mapStream(data => data.countries.items)
            .pipe(
                withLatestFrom(this.currentMembers$),
                map(([countries, currentMembers]) =>
                    countries.filter(c => !currentMembers.find(cm => cm.id === c.id)),
                ),
            );
    }

    cancel() {
        this.resolveWith();
    }

    add() {
        this.resolveWith(this.selectedMemberIds);
    }
}
