import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const updateCartLineInput = z.strictObject({
    orderLineId: idSchema.describe('Order line ID.'),
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
    usesActiveOrder: true,
    inputSchema: updateCartLineInput,
})
@Injectable()
export class UpdateCartLineTool implements McpToolHandler<UpdateCartLineInput> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateCartLineInput) {
        const order = await this.activeOrder.findOrThrow(ctx);
        return this.serializer.orderOrError(
            await this.orderService.adjustOrderLine(order.ctx, order.id, input.orderLineId, input.quantity),
        );
    }
}
