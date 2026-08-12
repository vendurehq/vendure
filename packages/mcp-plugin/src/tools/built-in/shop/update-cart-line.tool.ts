import { Injectable } from '@nestjs/common';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { getActiveOrder, orderResult } from '../order-helpers';

const updateCartLineInput = z.strictObject({
    orderLineId: z.union([z.string(), z.number()]).describe('Order line ID.'),
    quantity: z.number().describe('Quantity.'),
});

type UpdateCartLineInput = z.infer<typeof updateCartLineInput>;

@McpTool({
    name: 'update_cart_line',
    toolset: 'shop',
    description: 'Update the quantity of a cart line.',
    keywords: [
        'change the quantity',
        'buy more of this one',
        'increase how many I want',
        'reduce the amount in my basket',
        'adjust item count',
        'update the number of this item',
    ],
    permissions: [Permission.Public],
    behavior: 'mutating',
    inputSchema: updateCartLineInput,
})
@Injectable()
export class UpdateCartLineTool implements McpToolHandler<UpdateCartLineInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateCartLineInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return orderResult(undefined);
        return orderResult(
            await this.orderService.adjustOrderLine(ctx, order.id, input.orderLineId, input.quantity),
        );
    }
}
