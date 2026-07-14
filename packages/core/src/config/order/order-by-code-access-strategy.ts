import ms, { type StringValue } from 'ms';

import { RequestContext } from '../../api/common/request-context';
import { InjectableStrategy } from '../../common/types/injectable-strategy';
import { Order } from '../../entity/order/order.entity';

/**
 * @description
 * The OrderByCodeAccessStrategy determines how access to a placed Order via the
 * orderByCode query is granted.
 * With a custom strategy anonymous access could be made permanent or tied to specific
 * conditions like IP range or an Order status.
 *
 * @example
 * This example grants access to the requested Order to anyone – unless it's Monday.
 * ```ts
 * export class NotMondayOrderByCodeAccessStrategy implements OrderByCodeAccessStrategy {
 *     canAccessOrder(ctx: RequestContext, order: Order): boolean {
 *         const MONDAY = 1;
 *         const today = (new Date()).getDay();
 *
 *         return today !== MONDAY;
 *     }
 * }
 * ```
 *
 * :::info
 *
 * This is configured via the `orderOptions.orderByCodeAccessStrategy` property of
 * your VendureConfig.
 *
 * :::
 *
 * @since 1.1.0
 * @docsCategory orders
 * @docsPage OrderByCodeAccessStrategy
 */
export interface OrderByCodeAccessStrategy extends InjectableStrategy {
    /**
     * @description
     * Gives or denies permission to access the requested Order
     */
    canAccessOrder(ctx: RequestContext, order: Order): boolean | Promise<boolean>;
}

/**
 * @description
 * The default OrderByCodeAccessStrategy used by Vendure. It permitts permanent access to
 * the Customer owning the Order and anyone within a given time period after placing the Order
 * (defaults to 2h).
 *
 * @param anonymousAccessDuration value for [ms](https://github.com/vercel/ms), e.g. `2h` for 2 hours or `5d` for 5 days
 *
 * @docsCategory orders
 * @docsPage OrderByCodeAccessStrategy
 */
export class DefaultOrderByCodeAccessStrategy implements OrderByCodeAccessStrategy {
    private anonymousAccessDuration;

    constructor(anonymousAccessDuration: string) {
        this.anonymousAccessDuration = anonymousAccessDuration;
    }

    canAccessOrder(ctx: RequestContext, order: Order): boolean {
        // Order owned by active user
        const activeUserMatches = order?.customer?.user?.id === ctx.activeUserId;

        // For guest Customers, allow access to the Order for the following
        // time period
        const anonymousAccessPermitted = () => {
            const anonymousAccessLimit = ms(this.anonymousAccessDuration as StringValue);
            const orderPlaced = order.orderPlacedAt ? +order.orderPlacedAt : 0;
            const now = Date.now();
            return now - orderPlaced < anonymousAccessLimit;
        };

        return (ctx.activeUserId && activeUserMatches) || (!ctx.activeUserId && anonymousAccessPermitted());
    }
}
