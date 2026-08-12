import { Injectable } from '@nestjs/common';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { getActiveOrder, orderResult } from '../order-helpers';

const setShippingMethodInput = z.strictObject({
    methodId: z.union([z.string(), z.number()]).describe('Shipping method ID.'),
});

type SetShippingMethodInput = z.infer<typeof setShippingMethodInput>;

@McpTool({
    name: 'set_shipping_method',
    toolset: 'shop',
    description: 'Set the shipping method for the active cart.',
    keywords: [
        'choose a delivery option',
        'pick how it ships',
        'select express or standard',
        'set my postage choice',
        'select a courier',
        'how I want my order delivered',
    ],
    permissions: [Permission.Public],
    behavior: 'mutating',
    inputSchema: setShippingMethodInput,
})
@Injectable()
export class SetShippingMethodTool implements McpToolHandler<SetShippingMethodInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: SetShippingMethodInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return orderResult(undefined);
        return orderResult(await this.orderService.setShippingMethod(ctx, order.id, [input.methodId]));
    }
}
