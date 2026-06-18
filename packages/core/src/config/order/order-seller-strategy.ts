import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Channel } from '../../entity/channel/channel.entity';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';
import { ShippingLine } from '../../entity/shipping-line/shipping-line.entity';
import { OrderState } from '../../service/helpers/order-state-machine/order-state';

/**
 * @description
 * The contents of the aggregate Order which make up a single seller Order.
 *
 * @since 2.0.0
 * @docsCategory orders
 * @docsPage OrderSellerStrategy
 */
export interface SplitOrderContents {
    channelId: ID;
    state: OrderState;
    lines: OrderLine[];
    shippingLines: ShippingLine[];
}

/**
 * @description
 * This strategy defines how an Order can be split into multiple sub-orders for the use-case of
 * a multivendor application.
 *
 * :::info
 *
 * This is configured via the `orderOptions.orderSellerStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @since 2.0.0
 * @docsCategory orders
 * @docsPage OrderSellerStrategy
 * @docsWeight 0
 */
export interface OrderSellerStrategy extends InjectableStrategy {
    /**
     * @description
     * This method is called whenever a new OrderLine is added to the Order via the `addItemToOrder` mutation or the
     * underlying `addItemToOrder()` method of the {@link OrderService}.
     *
     * It should return the Channel to which this OrderLine will be assigned, which will be used to set the
     * {@link OrderLine} `sellerChannel` property.
     */
    setOrderLineSellerChannel?(
        ctx: RequestContext,
        orderLine: OrderLine,
    ): Channel | undefined | Promise<Channel | undefined>;

    /**
     * @description
     * Upon checkout (by default, when the Order moves from "active" to "inactive" according to the {@link OrderPlacedStrategy}),
     * this method will be called in order to split the Order into multiple Orders, one for each Seller.
     */
    splitOrder?(ctx: RequestContext, order: Order): SplitOrderContents[] | Promise<SplitOrderContents[]>;

    /**
     * @description
     * This method is called after splitting the orders, including calculating the totals for each of the seller Orders.
     * This method can be used to set platform fee surcharges on the seller Orders as well as perform any payment processing
     * needed.
     */
    afterSellerOrdersCreated?(
        ctx: RequestContext,
        aggregateOrder: Order,
        sellerOrders: Order[],
    ): void | Promise<void>;
}
