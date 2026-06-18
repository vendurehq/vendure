import { ChangeDetectionStrategy, Component, Input, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import {
    ChannelService,
    DataService,
    GetSellerOrdersQuery,
    GetSellerOrdersQueryVariables,
} from '@vendure/admin-ui/core';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import { Observable } from 'rxjs';

import { GET_SELLER_ORDERS } from './seller-orders-card.graphql';

type SellerOrder = NonNullable<NonNullable<GetSellerOrdersQuery['order']>['sellerOrders']>[number];

@Component({
    selector: 'vdr-seller-orders-card',
    templateUrl: './seller-orders-card.component.html',
    styleUrls: ['./seller-orders-card.component.scss'],
    changeDetection: ChangeDetectionStrategy.OnPush,
    standalone: false
})
export class SellerOrdersCardComponent implements OnInit {
    @Input() orderId: string;

    sellerOrders$: Observable<SellerOrder[]>;

    constructor(
        private router: Router,
        private dataService: DataService,
        private channelService: ChannelService,
    ) {}

    ngOnInit() {
        this.sellerOrders$ = this.dataService
            .query<GetSellerOrdersQuery, GetSellerOrdersQueryVariables>(GET_SELLER_ORDERS, {
                orderId: this.orderId,
            })
            .mapSingle(({ order }) => order?.sellerOrders ?? []);
    }

    getSeller(order: SellerOrder) {
        const sellerChannel = order.channels.find(channel => channel.code !== DEFAULT_CHANNEL_CODE);
        return sellerChannel?.seller;
    }

    navigateToSellerOrder(order: SellerOrder) {
        this.router.navigate(['/orders', order.id]);
    }
}
