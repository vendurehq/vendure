import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';

const getEligiblePaymentMethodsInput = z.strictObject({});

@McpTool({
    name: 'get_eligible_payment_methods',
    toolset: 'shop',
    description: 'List payment methods eligible for the active cart.',
    keywords: [
        'how can I pay',
        'what payment options do you take',
        'ways to pay for my order',
        'do you accept card or paypal',
        'available payment choices',
        'which payment types are allowed',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: getEligiblePaymentMethodsInput,
})
@Injectable()
export class GetEligiblePaymentMethodsTool implements McpToolHandler<Record<string, never>> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext) {
        const order = await this.activeOrder.find(ctx);
        if (!order) return { methods: [] };
        return { methods: await this.orderService.getEligiblePaymentMethods(ctx, order.id) };
    }
}
