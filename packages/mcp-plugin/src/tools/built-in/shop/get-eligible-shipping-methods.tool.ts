import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { McpToolSerializerService } from '../serializer.service';

const getEligibleShippingMethodsInput = z.strictObject({});

@McpTool({
    name: 'get_eligible_shipping_methods',
    toolset: 'shop',
    description: 'List shipping methods eligible for the active cart.',
    keywords: [
        'delivery options',
        'how will my order ship',
        'available shipping choices',
        'postage options for my basket',
        'ways to get my order delivered',
        'which couriers can I use',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    usesActiveOrder: true,
    inputSchema: getEligibleShippingMethodsInput,
})
@Injectable()
export class GetEligibleShippingMethodsTool implements McpToolHandler<Record<string, never>> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext) {
        const order = await this.activeOrder.find(ctx);
        if (!order) return { methods: [] };
        const quotes = await this.orderService.getEligibleShippingMethods(order.ctx, order.id);
        // The currency comes from the order because a quote does not carry one.
        return { methods: quotes.map(quote => this.serializer.shippingQuote(quote, order.currencyCode)) };
    }
}
