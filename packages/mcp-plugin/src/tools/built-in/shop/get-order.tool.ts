import { Injectable } from '@nestjs/common';
import { ConfigService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const getOrderInput = z.strictObject({
    code: z.string().describe('Order code.'),
});

type GetOrderInput = z.infer<typeof getOrderInput>;

@McpTool({
    name: 'get_order',
    toolset: 'shop',
    description: 'Get an accessible order by code.',
    keywords: [
        'track my order',
        'where is my package',
        'check my order status',
        'look up my purchase by number',
        'find my order with the reference',
        'how is my delivery going',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: getOrderInput,
})
@Injectable()
export class ShopGetOrderTool implements McpToolHandler<GetOrderInput> {
    constructor(
        private configService: ConfigService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetOrderInput) {
        const order = await this.orderService.findOneByCode(ctx, input.code, [
            'lines',
            'customer',
            'customer.user',
            'payments',
        ]);
        if (!order) return { order: null };
        const canAccess = await this.configService.orderOptions.orderByCodeAccessStrategy.canAccessOrder(
            ctx,
            order,
        );
        return { order: canAccess ? this.serializer.order(order) : null };
    }
}
