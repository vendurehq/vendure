import { Injectable } from '@nestjs/common';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { getActiveOrder } from '../order-helpers';
import { McpToolSerializerService } from '../serializer.service';

import { addressInputSchema } from './address-schema';

const setShippingAddressInput = z.strictObject({
    address: addressInputSchema,
});

type SetShippingAddressInput = z.infer<typeof setShippingAddressInput>;

@McpTool({
    name: 'set_shipping_address',
    toolset: 'shop',
    description: 'Set the active cart shipping address.',
    keywords: [
        'enter my delivery address',
        'where to ship my order',
        'add my shipping details',
        'set where I want it delivered',
        'my mailing address for the order',
        'send it to this address',
    ],
    permissions: [Permission.Public],
    behavior: 'mutating',
    inputSchema: setShippingAddressInput,
})
@Injectable()
export class SetShippingAddressTool implements McpToolHandler<SetShippingAddressInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: SetShippingAddressInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return { order: null };
        return {
            order: this.serializer.order(
                await this.orderService.setShippingAddress(ctx, order.id, input.address),
            ),
        };
    }
}
