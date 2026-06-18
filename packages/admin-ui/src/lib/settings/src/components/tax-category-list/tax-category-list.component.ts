import { ChangeDetectionStrategy, Component } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    GetTaxCategoryListDocument,
    TAX_CATEGORY_FRAGMENT,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const GET_TAX_CATEGORY_LIST = gql`
    query GetTaxCategoryList($options: TaxCategoryListOptions) {
        taxCategories(options: $options) {
            items {
                ...TaxCategory
            }
            totalItems
        }
    }
    ${TAX_CATEGORY_FRAGMENT}
`;

@Component({
    selector: 'vdr-tax-list',
    templateUrl: './tax-category-list.component.html',
    styleUrls: ['./tax-category-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class TaxCategoryListComponent extends TypedBaseListComponent<
    typeof GetTaxCategoryListDocument,
    'taxCategories'
> {
    dataTableListId = 'tax-category-list';
    readonly customFields = this.serverConfigService.getCustomFieldsFor('TaxCategory');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
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
            document: GetTaxCategoryListDocument,
            getItems: data => data.taxCategories,
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
