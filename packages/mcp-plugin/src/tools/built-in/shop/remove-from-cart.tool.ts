import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const removeFromCartInput = z.strictObject({
    orderLineId: idSchema.describe('Order line ID.'),
});

type RemoveFromCartInput = z.infer<typeof removeFromCartInput>;

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
    behavior: 'mutating',
    inputSchema: removeFromCartInput,
})
@Injectable()
export class RemoveFromCartTool implements McpToolHandler<RemoveFromCartInput> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: RemoveFromCartInput) {
        const order = await this.activeOrder.findOrCreate(ctx);
        if (!order) return this.serializer.orderOrError(undefined);
        return this.serializer.orderOrError(
            await this.orderService.removeItemFromOrder(ctx, order.id, input.orderLineId),
        );
    }
}
