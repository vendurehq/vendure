import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import { GetShippingMethodListDocument, TypedBaseListComponent } from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';

export const GET_SHIPPING_METHOD_LIST = gql`
    query GetShippingMethodList($options: ShippingMethodListOptions) {
        shippingMethods(options: $options) {
            items {
                ...ShippingMethodListItem
            }
            totalItems
        }
    }
    fragment ShippingMethodListItem on ShippingMethod {
        id
        createdAt
        updatedAt
        code
        name
        description
        fulfillmentHandlerCode
    }
`;

@Component({
    selector: 'vdr-shipping-method-list',
    templateUrl: './shipping-method-list.component.html',
    styleUrls: ['./shipping-method-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class ShippingMethodListComponent
    extends TypedBaseListComponent<typeof GetShippingMethodListDocument, 'shippingMethods'>
    implements OnInit
{
    dataTableListId = 'shipping-method-list';
    readonly customFields = this.getCustomFieldConfig('ShippingMethod');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilter({
            name: 'name',
            type: { kind: 'text' },
            label: _('common.name'),
            filterField: 'name',
        })
        .addFilter({
            name: 'code',
            type: { kind: 'text' },
            label: _('common.code'),
            filterField: 'code',
        })
        .addFilter({
            name: 'description',
            type: { kind: 'text' },
            label: _('common.description'),
            filterField: 'description',
        })
        .addFilter({
            name: 'fulfillmentHandler',
            type: { kind: 'text' },
            label: _('settings.fulfillment-handler'),
            filterField: 'fulfillmentHandlerCode',
        })
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .defaultSort('createdAt', 'DESC')
        .addSort({ name: 'createdAt' })
        .addSort({ name: 'updatedAt' })
        .addSort({ name: 'name' })
        .addSort({ name: 'code' })
        .addSort({ name: 'description' })
        .addSort({ name: 'fulfillmentHandlerCode' })
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    constructor() {
        super();
        super.configure({
            document: GetShippingMethodListDocument,
            getItems: data => data.shippingMethods,
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
