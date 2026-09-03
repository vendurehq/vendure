import { Injectable } from '@nestjs/common';
import { ConfigService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { ORDER_DETAIL_RELATIONS } from '../order-list-helpers';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

const getOrderInput = z.strictObject({
    code: shortText.describe('Order code.'),
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
        const order = await this.orderService.findOneByCode(ctx, input.code, ORDER_DETAIL_RELATIONS);
        const access = this.configService.orderOptions.orderByCodeAccessStrategy;
        if (order && (await access.canAccessOrder(ctx, order))) {
            return { order: this.serializer.order(order) };
        }
        // One message for "no such code" and "someone else's order": telling them apart would let an
        // anonymous caller find out which codes exist.
        return {
            order: null,
            message:
                `No order with code ${input.code} is visible to this caller. ` +
                'Sign in as the customer who placed it to see it.',
        };
    }
}
