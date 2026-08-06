import { Injectable } from '@nestjs/common';
import { ActiveOrderService, ID, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { getActiveOrder, orderResult } from '../order-helpers';
import { idProp, numberProp, objectSchema } from '../schema-helpers';

interface AddToCartInput {
    variantId: ID;
    quantity: number;
}

@McpTool({
    name: 'add_to_cart',
    toolset: 'shop',
    description: 'Add a product variant to the active cart.',
    keywords: [
        'put in my basket',
        'I want to buy this',
        'add this item to my bag',
        'grab this product',
        'start an order with this',
        'put this in my shopping bag',
    ],
    permissions: [Permission.Public],
    inputSchema: objectSchema({
        variantId: idProp('Product variant ID.'),
        quantity: numberProp('Quantity.'),
    }),
})
@Injectable()
export class AddToCartTool implements McpToolHandler<AddToCartInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: AddToCartInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return orderResult(undefined);
        return orderResult(
            await this.orderService.addItemToOrder(ctx, order.id, input.variantId, input.quantity),
        );
    }
}
