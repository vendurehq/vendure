import { Injectable } from '@nestjs/common';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { getActiveOrder } from '../order-helpers';
import { objectSchema } from '../schema-helpers';
import { orderSummary } from '../serializers';

@McpTool({
    name: 'get_cart',
    toolset: 'shop',
    description: 'Get the active cart for the current MCP session.',
    keywords: [
        "what's in my basket",
        'show my shopping bag',
        "view what I'm buying",
        'my current order so far',
        'see my cart contents',
        'how much is in my basket',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: objectSchema({}),
})
@Injectable()
export class GetCartTool implements McpToolHandler<Record<string, never>> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, false);
        return { order: orderSummary(order) };
    }
}
