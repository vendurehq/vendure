import { Injectable } from '@nestjs/common';
import { CreateAddressInput } from '@vendure/common/lib/generated-types';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { getActiveOrder } from '../order-helpers';
import { booleanProp, jsonObjectProp, objectSchema, optional, stringProp } from '../schema-helpers';
import { orderSummary } from '../serializers';

interface SetBillingAddressInput {
    address: CreateAddressInput;
}

const addressInputSchema = objectSchema({
    fullName: optional(stringProp()),
    company: optional(stringProp()),
    streetLine1: stringProp(),
    streetLine2: optional(stringProp()),
    city: optional(stringProp()),
    province: optional(stringProp()),
    postalCode: optional(stringProp()),
    countryCode: stringProp(),
    phoneNumber: optional(stringProp()),
    defaultShippingAddress: optional(booleanProp()),
    defaultBillingAddress: optional(booleanProp()),
    customFields: optional(jsonObjectProp('Address custom fields.')),
});

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
    inputSchema: objectSchema({ address: addressInputSchema }),
})
@Injectable()
export class SetBillingAddressTool implements McpPluginToolHandler<SetBillingAddressInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: SetBillingAddressInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return { order: null };
        return {
            order: orderSummary(await this.orderService.setBillingAddress(ctx, order.id, input.address)),
        };
    }
}
