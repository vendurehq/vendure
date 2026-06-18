import { Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { CustomerListQueryDocument, LogicalOperator, TypedBaseListComponent } from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const CUSTOMER_LIST_QUERY = gql`
    query CustomerListQuery($options: CustomerListOptions) {
        customers(options: $options) {
            items {
                ...CustomerListItem
            }
            totalItems
        }
    }

    fragment CustomerListItem on Customer {
        id
        createdAt
        updatedAt
        title
        firstName
        lastName
        emailAddress
        user {
            id
            verified
        }
    }
`;

@Component({
    selector: 'vdr-customer-list',
    templateUrl: './customer-list.component.html',
    styleUrls: ['./customer-list.component.scss'],
    standalone: false,
})
export class CustomerListComponent
    extends TypedBaseListComponent<typeof CustomerListQueryDocument, 'customers'>
    implements OnInit
{
    dataTableListId = 'customer-list';
    readonly customFields = this.getCustomFieldConfig('Customer');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilter({
            name: 'firstName',
            type: { kind: 'text' },
            label: _('customer.first-name'),
            filterField: 'firstName',
        })
        .addFilter({
            name: 'lastName',
            type: { kind: 'text' },
            label: _('customer.last-name'),
            filterField: 'lastName',
        })
        .addFilter({
            name: 'emailAddress',
            type: { kind: 'text' },
            label: _('customer.email-address'),
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
        this.configure({
            document: CustomerListQueryDocument,
            getItems: data => data.customers,
            setVariables: (skip, take) => ({
                options: {
                    skip,
                    take,
                    filter: {
                        ...(this.searchTermControl.value
                            ? {
                                  emailAddress: {
                                      contains: this.searchTermControl.value,
                                  },
                                  lastName: {
                                      contains: this.searchTermControl.value,
                                  },
                                  postalCode: {
                                      contains: this.searchTermControl.value,
                                  },
                              }
                            : {}),
                        ...this.filters.createFilterInput(),
                    },
                    filterOperator: this.searchTermControl.value ? LogicalOperator.OR : LogicalOperator.AND,
                    sort: this.sorts.createSortInput(),
                },
            }),
            refreshListOnChanges: [this.sorts.valueChanges, this.filters.valueChanges],
        });
    }
}
