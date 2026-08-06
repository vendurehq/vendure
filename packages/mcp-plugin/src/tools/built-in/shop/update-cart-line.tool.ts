import { Injectable } from '@nestjs/common';
import { ActiveOrderService, ID, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { getActiveOrder, orderResult } from '../order-helpers';
import { idProp, numberProp, objectSchema } from '../schema-helpers';

interface UpdateCartLineInput {
    orderLineId: ID;
    quantity: number;
}

@McpTool({
    name: 'update_cart_line',
    toolset: 'shop',
    description: 'Update the quantity of a cart line.',
    keywords: [
        'change the quantity',
        'buy more of this one',
        'increase how many I want',
        'reduce the amount in my basket',
        'adjust item count',
        'update the number of this item',
    ],
    permissions: [Permission.Public],
    inputSchema: objectSchema({ orderLineId: idProp('Order line ID.'), quantity: numberProp('Quantity.') }),
})
@Injectable()
export class UpdateCartLineTool implements McpPluginToolHandler<UpdateCartLineInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateCartLineInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return orderResult(undefined);
        return orderResult(
            await this.orderService.adjustOrderLine(ctx, order.id, input.orderLineId, input.quantity),
        );
    }
}
