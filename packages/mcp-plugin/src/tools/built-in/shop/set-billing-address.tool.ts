import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { McpToolSerializerService } from '../serializer.service';

import { addressInputSchema } from './address-schema';

const setBillingAddressInput = z.strictObject({
    address: addressInputSchema,
});

type SetBillingAddressInput = z.infer<typeof setBillingAddressInput>;

@McpTool({
    name: 'set_billing_address',
    toolset: 'shop',
    description: 'Set the active cart billing address.',
    keywords: [
        'enter my billing address',
        'where to send the invoice',
        'add my payment address',
        'set the address on my card',
        'billing details for checkout',
        'my invoice address',
    ],
    permissions: [Permission.Public],
    behavior: 'mutating',
    inputSchema: setBillingAddressInput,
})
@Injectable()
export class SetBillingAddressTool implements McpToolHandler<SetBillingAddressInput> {
    constructor(
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: SetBillingAddressInput) {
        const order = await this.activeOrder.findOrCreate(ctx);
        // setBillingAddress returns a plain Order (no error union), so order() rather than orderOrError().
        return {
            order: this.serializer.order(
                await this.orderService.setBillingAddress(ctx, order.id, input.address),
            ),
        };
    }
}
