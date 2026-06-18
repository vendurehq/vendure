import { ChangeDetectionStrategy, Component, NgModule, OnInit } from '@angular/core';
import {
    CoreModule,
    DataService,
    GetLatestOrdersDocument,
    GetLatestOrdersQuery,
    GetOrderListQuery,
    ItemOf,
    SharedModule,
    SortOrder,
} from '@vendure/admin-ui/core';
import { gql } from 'apollo-angular';
import { Observable } from 'rxjs';

const GET_LATEST_ORDERS = gql`
    query GetLatestOrders($options: OrderListOptions) {
        orders(options: $options) {
            items {
                id
                createdAt
                updatedAt
                type
                orderPlacedAt
                code
                state
                total
                totalWithTax
                currencyCode
                customer {
                    id
                    firstName
                    lastName
                }
            }
        }
    }
`;

@Component({
    selector: 'vdr-latest-orders-widget',
    templateUrl: './latest-orders-widget.component.html',
    styleUrls: ['./latest-orders-widget.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false,
})
export class LatestOrdersWidgetComponent implements OnInit {
    latestOrders$: Observable<Array<ItemOf<GetLatestOrdersQuery, 'orders'>>>;
    constructor(private dataService: DataService) {}

    ngOnInit(): void {
        this.latestOrders$ = this.dataService
            .query(GetLatestOrdersDocument, {
                options: {
                    take: 10,
                    filter: {
                        active: { eq: false },
                        state: { notIn: ['Cancelled', 'Draft'] },
                    },
                    sort: {
                        orderPlacedAt: SortOrder.DESC,
                    },
                },
            })
            .refetchOnChannelChange()
            .mapStream(data => data.orders.items);
    }
}

@NgModule({
    imports: [CoreModule, SharedModule],
    declarations: [LatestOrdersWidgetComponent],
})
export class LatestOrdersWidgetModule {}
