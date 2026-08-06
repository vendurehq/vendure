import { Injectable } from '@nestjs/common';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { getActiveOrder } from '../order-helpers';
import { objectSchema } from '../schema-helpers';

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
    inputSchema: objectSchema({}),
})
@Injectable()
export class GetEligiblePaymentMethodsTool implements McpPluginToolHandler<Record<string, never>> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, false);
        if (!order) return { methods: [] };
        return { methods: await this.orderService.getEligiblePaymentMethods(ctx, order.id) };
    }
}
