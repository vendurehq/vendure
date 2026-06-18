import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { GetSellerListDocument, TypedBaseListComponent } from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

const GET_SELLER_LIST = gql`
    query GetSellerList($options: SellerListOptions) {
        sellers(options: $options) {
            items {
                ...SellerListItem
            }
            totalItems
        }
    }
    fragment SellerListItem on Seller {
        id
        createdAt
        updatedAt
        name
    }
`;

@Component({
    selector: 'vdr-seller-list',
    templateUrl: './seller-list.component.html',
    styleUrls: ['./seller-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class SellerListComponent
    extends TypedBaseListComponent<typeof GetSellerListDocument, 'sellers'>
    implements OnInit
{
    dataTableListId = 'seller-list';
    readonly customFields = this.getCustomFieldConfig('Seller');
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

    constructor() {
        super();
        super.configure({
            document: GetSellerListDocument,
            getItems: data => data.sellers,
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
                    sort: this.sorts.createSortInput(),
                },
            }),
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });
    }
}
