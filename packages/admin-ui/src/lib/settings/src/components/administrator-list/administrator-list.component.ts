import { Component } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    ADMINISTRATOR_FRAGMENT,
    GetAdministratorListDocument,
    LogicalOperator,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const GET_ADMINISTRATOR_LIST = gql`
    query GetAdministratorList($options: AdministratorListOptions) {
        administrators(options: $options) {
            items {
                ...AdministratorListItem
            }
            totalItems
        }
    }
    fragment AdministratorListItem on Administrator {
        id
        createdAt
        updatedAt
        firstName
        lastName
        emailAddress
        user {
            id
            identifier
            lastLogin
            roles {
                id
                createdAt
                updatedAt
                code
                description
            }
        }
    }
`;

@Component({
    selector: 'vdr-administrator-list',
    templateUrl: './administrator-list.component.html',
    styleUrls: ['./administrator-list.component.scss'],
    standalone: false
})
export class AdministratorListComponent extends TypedBaseListComponent<
    typeof GetAdministratorListDocument,
    'administrators'
> {
    dataTableListId = 'administrator-list';
    readonly customFields = this.getCustomFieldConfig('Administrator');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilter({
            name: 'firstName',
            type: { kind: 'text' },
            label: _('settings.first-name'),
            filterField: 'firstName',
        })
        .addFilter({
            name: 'lastName',
            type: { kind: 'text' },
            label: _('settings.last-name'),
            filterField: 'lastName',
        })
        .addFilter({
            name: 'emailAddress',
            type: { kind: 'text' },
            label: _('settings.email-address'),
            filterField: 'emailAddress',
        })
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .defaultSort('createdAt', 'DESC')
        .addSort({ name: 'createdAt' })
        .addSort({ name: 'updatedAt' })
        .addSort({ name: 'lastName' })
        .addSort({ name: 'emailAddress' })
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor() {
        super();
        super.configure({
            document: GetAdministratorListDocument,
            getItems: data => data.administrators,
            setVariables: (skip, take) => this.createSearchQuery(skip, take, this.searchTermControl.value),
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });
    }

    createSearchQuery(skip: number, take: number, searchTerm: string | null) {
        let _filter = {};
        let filterOperator: LogicalOperator = LogicalOperator.AND;

        if (searchTerm) {
            _filter = {
                emailAddress: {
                    contains: searchTerm,
                },
                firstName: {
                    contains: searchTerm,
                },
                lastName: {
                    contains: searchTerm,
                },
            };
            filterOperator = LogicalOperator.OR;
        }
        return {
            options: {
                skip,
                take,
                filter: {
                    ...(_filter ?? {}),
                    ...this.filters.createFilterInput(),
                },
                sort: this.sorts.createSortInput(),
                filterOperator,
            },
        };
    }
}
