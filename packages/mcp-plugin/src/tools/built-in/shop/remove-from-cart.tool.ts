import { Injectable } from '@nestjs/common';
import { ActiveOrderService, ID, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { getActiveOrder, orderResult } from '../order-helpers';
import { idProp, objectSchema } from '../schema-helpers';

interface RemoveFromCartInput {
    orderLineId: ID;
}

@McpTool({
    name: 'remove_from_cart',
    toolset: 'shop',
    description: 'Remove a line from the active cart.',
    keywords: [
        'take this out of my basket',
        'delete an item from my cart',
        'remove this product',
        "I don't want this anymore",
        'drop a line from my order',
        'get rid of a cart item',
    ],
    permissions: [Permission.Public],
    inputSchema: objectSchema({ orderLineId: idProp('Order line ID.') }),
})
@Injectable()
export class RemoveFromCartTool implements McpToolHandler<RemoveFromCartInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: RemoveFromCartInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return orderResult(undefined);
        return orderResult(await this.orderService.removeItemFromOrder(ctx, order.id, input.orderLineId));
    }
}
