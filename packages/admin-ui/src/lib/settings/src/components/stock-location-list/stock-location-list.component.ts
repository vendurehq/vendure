import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { GetStockLocationListDocument, TypedBaseListComponent } from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const GET_STOCK_LOCATION_LIST = gql`
    query GetStockLocationList($options: StockLocationListOptions) {
        stockLocations(options: $options) {
            items {
                ...StockLocationListItem
            }
            totalItems
        }
    }
    fragment StockLocationListItem on StockLocation {
        id
        createdAt
        updatedAt
        name
        description
    }
`;

@Component({
    selector: 'vdr-stock-location-list',
    templateUrl: './stock-location-list.component.html',
    styleUrls: ['./stock-location-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class StockLocationListComponent
    extends TypedBaseListComponent<typeof GetStockLocationListDocument, 'stockLocations'>
    implements OnInit
{
    dataTableListId = 'stock-location-list';
    readonly customFields = this.getCustomFieldConfig('StockLocation');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilters([
            {
                name: 'enabled',
                type: { kind: 'text' },
                label: _('common.enabled'),
                filterField: 'name',
            },
            {
                name: 'sku',
                type: { kind: 'text' },
                label: _('catalog.sku'),
                filterField: 'description',
            },
        ])
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .addSorts([
            { name: 'id' },
            { name: 'createdAt' },
            { name: 'updatedAt' },
            { name: 'name' },
            { name: 'description' },
        ])
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor() {
        super();
        this.configure({
            document: GetStockLocationListDocument,
            getItems: data => data.stockLocations,
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
            refreshListOnChanges: [this.sorts.valueChanges, this.filters.valueChanges],
        });
    }
}
