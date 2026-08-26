import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const getOrderInput = z.strictObject({
    id: idSchema.describe('Order ID.'),
});

type GetOrderInput = z.infer<typeof getOrderInput>;

// `get_order` exists in both toolsets, so this class gets its own name rather than reusing the shop
// `ShopGetOrderTool`. A distinct class means stack traces and editor symbol search point at the right one.
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
    constructor(
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetOrderInput) {
        return {
            order: this.serializer.order(
                await this.orderService.findOne(ctx, input.id, [
                    'lines',
                    'shippingLines',
                    'customer',
                    'payments',
                ]),
            ),
        };
    }
}
