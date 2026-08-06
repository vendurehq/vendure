import { Injectable } from '@nestjs/common';
import { ID, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { orderResult } from '../order-helpers';
import { booleanProp, idProp, objectSchema, optional, stringProp } from '../schema-helpers';

interface CancelOrderToolInput {
    id: ID;
    reason?: string;
    cancelShipping?: boolean;
}

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
    inputSchema: objectSchema({
        id: idProp('Order ID.'),
        reason: optional(stringProp('Reason for the cancellation.')),
        cancelShipping: optional(booleanProp('Also cancel shipping charges. Defaults to true.')),
    }),
})
@Injectable()
export class CancelOrderTool implements McpPluginToolHandler<CancelOrderToolInput> {
    constructor(private orderService: OrderService) {}

    async execute(ctx: RequestContext, input: CancelOrderToolInput) {
        return orderResult(
            await this.orderService.cancelOrder(ctx, {
                orderId: input.id,
                reason: input.reason,
                // Default to cancelling shipping unless the caller explicitly opts out.
                cancelShipping: input.cancelShipping !== false,
            }),
        );
    }
}
