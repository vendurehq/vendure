import { ID } from '@vendure/common/lib/shared-types';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';
import { OrderLine } from '../../entity/order-line/order-line.entity';

/**
 * @description
 * The result of the {@link OrderMergeStrategy} `merge` method.
 *
 * @docsCategory orders
 * @docsPage OrderMergeStrategy
 */
export interface MergedOrderLine {
    orderLineId: ID;
    quantity: number;
    customFields?: any;
}

export function toMergedOrderLine(line: OrderLine): MergedOrderLine {
    return {
        orderLineId: line.id,
        quantity: line.quantity,
        customFields: line.customFields,
    };
}

/**
 * @description
 * An OrderMergeStrategy defines what happens when a Customer with an existing Order
 * signs in with a guest Order, where both Orders may contain differing OrderLines.
 *
 * Somehow these differing OrderLines need to be reconciled into a single collection
 * of OrderLines. The OrderMergeStrategy defines the rules governing this reconciliation.
 *
 * :::info
 *
 * This is configured via the `orderOptions.mergeStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @docsCategory orders
 * @docsPage OrderMergeStrategy
 * @docsWeight 0
 */
export interface OrderMergeStrategy extends InjectableStrategy {
    /**
     * @description
     * Merges the lines of the guest Order with those of the existing Order which is associated
     * with the active customer.
     */
    merge(ctx: RequestContext, guestOrder: Order, existingOrder: Order): MergedOrderLine[] | Promise<MergedOrderLine[]>;
}
