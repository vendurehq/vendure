import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { idSchema, longText, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { describeOrder, findOrderOrThrow } from '../order-list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const cancelOrderInput = z.strictObject({
    id: idSchema.describe('Order ID.'),
    reason: longText.describe('Reason for the cancellation.').optional(),
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
        private readonly orderService: OrderService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async describe(ctx: RequestContext, input: CancelOrderToolInput) {
        const order = await findOrderOrThrow(this.orderService, ctx, input.id, ['lines']);
        const shipping = input.cancelShipping === false ? 'Shipping charges stay.' : 'Shipping is cancelled too.';
        const reason = input.reason ? ` Reason: ${input.reason}.` : '';
        return (
            `Cancel ${describeOrder(order, value => this.serializer.decimal(value))}, ` +
            `${order.lines.length} line(s), and restock the cancelled lines. ${shipping}${reason}`
        );
    }

    async execute(ctx: RequestContext, input: CancelOrderToolInput) {
        return this.serializer.orderOrError(
            await this.orderService.cancelOrder(ctx, {
                orderId: input.id,
                reason: input.reason,
                cancelShipping: input.cancelShipping !== false,
            }),
        );
    }
}
