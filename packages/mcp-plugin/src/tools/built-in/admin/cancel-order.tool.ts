import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const cancelOrderInput = z.strictObject({
    id: z.union([z.string(), z.number()]).describe('Order ID.'),
    reason: z.string().describe('Reason for the cancellation.').optional(),
    cancelShipping: z.boolean().describe('Also cancel shipping charges. Defaults to true.').optional(),
});

type CancelOrderToolInput = z.infer<typeof cancelOrderInput>;

@McpTool({
    name: 'cancel_order',
    toolset: 'admin',
    description: 'Cancel an order and restock cancelled lines.',
    keywords: [
        'void an order',
        "cancel a customer's purchase",
        'call off this order',
        'scrap the order and restock',
        'abort an order',
        'kill this order',
    ],
    permissions: [Permission.UpdateOrder],
    behavior: 'destructive',
    inputSchema: cancelOrderInput,
})
@Injectable()
export class CancelOrderTool implements McpToolHandler<CancelOrderToolInput> {
    constructor(
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CancelOrderToolInput) {
        return this.serializer.orderOrError(
            await this.orderService.cancelOrder(ctx, {
                orderId: input.id,
                reason: input.reason,
                // Default to cancelling shipping unless the caller explicitly opts out.
                cancelShipping: input.cancelShipping !== false,
            }),
        );
    }
}
