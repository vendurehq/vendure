import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
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
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: SetShippingAddressInput) {
        const order = await this.activeOrder.findOrCreate(ctx);
        return {
            order: this.serializer.order(
                await this.orderService.setShippingAddress(ctx, order.id, input.address),
            ),
        };
    }
}
