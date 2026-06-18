import { Component, Input, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    DataTableLocationId,
    ProductVariantFilterParameter,
    ProductVariantListQueryDocument,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';

@Component({
    selector: 'vdr-product-variant-list',
    templateUrl: './product-variant-list.component.html',
    styleUrls: ['./product-variant-list.component.scss'],
    standalone: false,
})
export class ProductVariantListComponent
    extends TypedBaseListComponent<typeof ProductVariantListQueryDocument, 'productVariants'>
    implements OnInit
{
    @Input() productId?: string;
    @Input() hideLanguageSelect = false;
    pageLocationId = 'product-variant-list' as const;
    @Input() dataTableId: DataTableLocationId | undefined;
    readonly customFields = this.getCustomFieldConfig('ProductVariant');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilters([
            {
                name: 'name',
                type: { kind: 'text' },
                label: _('common.name'),
                filterField: 'name',
            },
            {
                name: 'enabled',
                type: { kind: 'boolean' },
                label: _('common.enabled'),
                filterField: 'enabled',
            },
            {
                name: 'sku',
                type: { kind: 'text' },
                label: _('catalog.sku'),
                filterField: 'sku',
            },
            {
                name: 'price',
                type: { kind: 'number', inputType: 'currency' },
                label: _('common.price'),
                filterField: 'price',
            },
            {
                name: 'priceWithTax',
                type: { kind: 'number', inputType: 'currency' },
                label: _('common.price-with-tax'),
                filterField: 'priceWithTax',
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
            { name: 'sku' },
            { name: 'price' },
            { name: 'priceWithTax' },
        ])
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor() {
        super();
        this.configure({
            document: ProductVariantListQueryDocument,
            getItems: data => data.productVariants,
            setVariables: (skip, take) => {
                const searchTerm = this.searchTermControl.value;
                const filterParam: ProductVariantFilterParameter = { _and: [] };
                const filterInput = this.filters.createFilterInput();
                if (Object.keys(filterInput).length) {
                    filterParam._and?.push(filterInput);
                }
                if (searchTerm) {
                    filterParam._and?.push({
                        _or: [
                            {
                                name: { contains: searchTerm },
                            },
                            {
                                sku: { contains: searchTerm },
                            },
                        ],
                    });
                }
                if (this.productId) {
                    filterParam._and?.push({
                        productId: {
                            eq: this.productId,
                        },
                    });
                }
                return {
                    options: {
                        skip,
                        take,
                        filter: filterParam,
                        sort: this.sorts.createSortInput(),
                    },
                };
            },
            refreshListOnChanges: [this.sorts.valueChanges, this.filters.valueChanges],
        });
    }
}
