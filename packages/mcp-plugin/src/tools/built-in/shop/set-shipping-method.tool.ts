import { Injectable } from '@nestjs/common';
import { ActiveOrderService, ID, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { getActiveOrder, orderResult } from '../order-helpers';
import { idProp, objectSchema } from '../schema-helpers';

interface SetShippingMethodInput {
    methodId: ID;
}

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
    inputSchema: objectSchema({ methodId: idProp('Shipping method ID.') }),
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
