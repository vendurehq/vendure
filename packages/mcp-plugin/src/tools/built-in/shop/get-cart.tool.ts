import { Injectable } from '@nestjs/common';
import { Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService, NO_CART_MESSAGE } from '../active-order.service';
import { McpToolSerializerService } from '../serializer.service';

const getCartInput = z.strictObject({});

@McpTool({
    name: 'get_cart',
    toolset: 'shop',
    description: 'Get the active cart. Pass the sessionToken from earlier cart responses to see that cart.',
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
    usesActiveOrder: true,
    inputSchema: getCartInput,
})
@Injectable()
export class GetCartTool implements McpToolHandler<Record<string, never>> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext) {
        const order = await this.activeOrder.findOrderWithLines(ctx);
        if (!order) return { order: null, message: NO_CART_MESSAGE };
        return { order: this.serializer.order(order) };
    }
}
