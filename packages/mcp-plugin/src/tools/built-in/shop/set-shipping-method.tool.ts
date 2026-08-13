import { Injectable } from '@nestjs/common';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { getActiveOrder } from '../order-helpers';
import { McpToolSerializerService } from '../serializer.service';

const setShippingMethodInput = z.strictObject({
    methodId: idSchema.describe('Shipping method ID.'),
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
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: SetShippingMethodInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return this.serializer.orderOrError(undefined);
        return this.serializer.orderOrError(
            await this.orderService.setShippingMethod(ctx, order.id, [input.methodId]),
        );
    }
}
