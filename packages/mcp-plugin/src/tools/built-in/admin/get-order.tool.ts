import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { orderSummary } from '../serializers';

const getOrderInput = z.strictObject({
    id: z.union([z.string(), z.number()]).describe('Order ID.'),
});

type GetOrderInput = z.infer<typeof getOrderInput>;

// Class name is deliberately distinct from the shop `GetOrderTool` (`get_order` exists in both
// toolsets). Declared, not aliased, so stack traces and jump-to-symbol self-disambiguate.
@McpTool({
    name: 'get_order',
    toolset: 'admin',
    description: 'Get an order by id.',
    keywords: [
        'look up an order in the back office',
        'pull up order details for support',
        'inspect a single order',
        'open an order record by id',
        'view an order as staff',
        'fetch order info for operations',
    ],
    permissions: [Permission.ReadOrder],
    behavior: 'readonly',
    inputSchema: getOrderInput,
})
@Injectable()
export class AdminGetOrderTool implements McpToolHandler<GetOrderInput> {
    constructor(private orderService: OrderService) {}

    async execute(ctx: RequestContext, input: GetOrderInput) {
        return {
            order: orderSummary(
                await this.orderService.findOne(ctx, input.id, ['lines', 'customer', 'payments']),
            ),
        };
    }
}
