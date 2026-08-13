import { Injectable } from '@nestjs/common';
import { ActiveOrderService, Order, OrderService, RequestContext } from '@vendure/core';

/**
 * Fetches the shopper's current cart for the built-in shop tools.
 *
 * Vendure's `ActiveOrderService` finds the active order, but for an anonymous shopper the order it
 * hands back has no order lines attached, and every shop tool reports what is in the cart. So each
 * lookup here re-loads the order with its lines and their product variants.
 *
 * There are two methods rather than one method taking a create-or-not flag because Vendure's
 * `getActiveOrder` is overloaded on the literal value `true`: a variable of type `boolean` matches
 * neither signature.
 */
@Injectable()
export class McpActiveOrderService {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    /** The shopper's current cart, or undefined when they have none. */
    async find(ctx: RequestContext): Promise<Order | undefined> {
        return this.withLines(ctx, await this.activeOrderService.getActiveOrder(ctx, undefined));
    }

    /** The shopper's current cart, creating an empty one when they have none. */
    async findOrCreate(ctx: RequestContext): Promise<Order | undefined> {
        return this.withLines(ctx, await this.activeOrderService.getActiveOrder(ctx, undefined, true));
    }

    private async withLines(ctx: RequestContext, order: Order | undefined): Promise<Order | undefined> {
        if (!order) {
            return undefined;
        }
        return (await this.orderService.findOne(ctx, order.id, ['lines', 'lines.productVariant'])) ?? order;
    }
}
