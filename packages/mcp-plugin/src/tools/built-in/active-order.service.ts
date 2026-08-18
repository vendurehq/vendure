import { Injectable } from '@nestjs/common';
import { ActiveOrderService, Order, OrderService, RequestContext } from '@vendure/core';

export type ActiveOrderRef = Pick<Order, 'id' | 'currencyCode'>;

@Injectable()
export class McpActiveOrderService {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    /** The shopper's current cart, or undefined when they have none. Order lines are not loaded. */
    async find(ctx: RequestContext): Promise<ActiveOrderRef | undefined> {
        return this.activeOrderService.getActiveOrder(ctx, undefined);
    }

    /**
     * The shopper's current cart, creating an empty one when they have none. Order lines are not
     * loaded.
     */
    async findOrCreate(ctx: RequestContext): Promise<ActiveOrderRef> {
        // Never undefined: core throws a UserInputError when it can neither find nor create one.
        return this.activeOrderService.getActiveOrder(ctx, undefined, true);
    }

    async findWithLines(ctx: RequestContext): Promise<Order | undefined> {
        const order = await this.activeOrderService.getActiveOrder(ctx, undefined);
        if (!order) {
            return undefined;
        }
        return (await this.orderService.findOne(ctx, order.id, ['lines', 'lines.productVariant'])) ?? order;
    }
}
