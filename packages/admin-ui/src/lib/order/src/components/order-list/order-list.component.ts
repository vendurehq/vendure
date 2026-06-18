import { ChangeDetectionStrategy, Component, OnInit } from '@angular/core';
import { marker as _ } from '@biesbjerg/ngx-translate-extract-marker';
import {
    ChannelService,
    GetOrderListDocument,
    getOrderStateTranslationToken,
    LogicalOperator,
    OrderListOptions,
    OrderType,
    ServerConfigService,
    TypedBaseListComponent,
} from '@vendure/admin-ui/core';
import { Order } from '@vendure/common/lib/generated-types';
import { tap } from 'rxjs/operators';

@Component({
    selector: 'vdr-order-list',
    templateUrl: './order-list.component.html',
    styleUrls: ['./order-list.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class OrderListComponent
    extends TypedBaseListComponent<typeof GetOrderListDocument, 'orders'>
    implements OnInit
{
    dataTableListId = 'order-list';
    orderStates = this.serverConfigService.getOrderProcessStates().map(item => item.name);
    readonly OrderType = OrderType;
    readonly customFields = this.getCustomFieldConfig('Order');
    readonly filters = this.createFilterCollection()
        .addIdFilter()
        .addDateFilters()
        .addFilter({
            name: 'active',
            type: { kind: 'boolean' },
            label: _('order.filter-is-active'),
            filterField: 'active',
        })
        .addFilter({
            name: 'totalWithTax',
            type: { kind: 'number', inputType: 'currency', currencyCode: 'USD' },
            label: _('order.total'),
            filterField: 'totalWithTax',
        })
        .addFilter({
            name: 'state',
            type: {
                kind: 'select',
                options: this.orderStates.map(s => ({ value: s, label: getOrderStateTranslationToken(s) })),
            },
            label: _('order.state'),
            filterField: 'state',
        })
        .addFilter({
            name: 'type',
            type: {
                kind: 'select',
                options: [
                    { value: OrderType.Regular, label: _('order.order-type-regular') },
                    { value: OrderType.Aggregate, label: _('order.order-type-aggregate') },
                    { value: OrderType.Seller, label: _('order.order-type-seller') },
                ],
            },
            label: _('order.order-type'),
            filterField: 'type',
        })
        .addFilter({
            name: 'orderPlacedAt',
            type: { kind: 'dateRange' },
            label: _('order.placed-at'),
            filterField: 'orderPlacedAt',
        })
        .addFilter({
            name: 'customerLastName',
            type: { kind: 'text' },
            label: _('customer.last-name'),
            filterField: 'customerLastName',
        })
        .addFilter({
            name: 'transactionId',
            type: { kind: 'text' },
            label: _('order.transaction-id'),
            filterField: 'transactionId',
        })
        .addCustomFieldFilters(this.customFields)
        .connectToRoute(this.route);

    readonly sorts = this.createSortCollection()
        .defaultSort('updatedAt', 'DESC')
        .addSort({ name: 'id' })
        .addSort({ name: 'createdAt' })
        .addSort({ name: 'updatedAt' })
        .addSort({ name: 'orderPlacedAt' })
        .addSort({ name: 'customerLastName' })
        .addSort({ name: 'state' })
        .addSort({ name: 'totalWithTax' })
        .addCustomFieldSorts(this.customFields)
        .connectToRoute(this.route);

    canCreateDraftOrder = false;
    private activeChannelIsDefaultChannel = false;

    constructor(
        protected serverConfigService: ServerConfigService,
        private channelService: ChannelService,
    ) {
        super();
        super.configure({
            document: GetOrderListDocument,
            getItems: result => result.orders,
            setVariables: (skip, take) => this.createQueryOptions(skip, take, this.searchTermControl.value),
            refreshListOnChanges: [this.filters.valueChanges, this.sorts.valueChanges],
        });

        this.canCreateDraftOrder = !!this.serverConfigService
            .getOrderProcessStates()
            .find(state => state.name === 'Created')
            ?.to.includes('Draft');
    }

    ngOnInit() {
        super.ngOnInit();
        const isDefaultChannel$ = this.channelService.defaultChannelIsActive$.pipe(
            tap(isDefault => (this.activeChannelIsDefaultChannel = isDefault)),
        );
        super.refreshListOnChanges(this.filters.valueChanges, this.sorts.valueChanges, isDefaultChannel$);
    }

    private createQueryOptions(
        // eslint-disable-next-line @typescript-eslint/no-shadow
        skip: number,
        take: number,
        searchTerm: string | null,
    ): { options: OrderListOptions } {
        let filterInput = this.filters.createFilterInput();
        if (this.activeChannelIsDefaultChannel) {
            filterInput = {
                ...(filterInput ?? {}),
            };
        }
        if (searchTerm) {
            filterInput = {
                code: {
                    contains: searchTerm,
                },
                customerLastName: {
                    contains: searchTerm,
                },
                transactionId: {
                    contains: searchTerm,
                },
            };
        }
        return {
            options: {
                skip,
                take,
                filter: {
                    ...(filterInput ?? {}),
                },
                filterOperator: searchTerm ? LogicalOperator.OR : LogicalOperator.AND,
                sort: this.sorts.createSortInput(),
            },
        };
    }

    getShippingNames(order: Order) {
        if (order.shippingLines.length) {
            return order.shippingLines.map(shippingLine => shippingLine.shippingMethod.name).join(', ');
        } else {
            return '';
        }
    }
}
