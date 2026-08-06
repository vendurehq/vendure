import { Injectable } from '@nestjs/common';
import { CreateAddressInput } from '@vendure/common/lib/generated-types';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { getActiveOrder } from '../order-helpers';
import { booleanProp, jsonObjectProp, objectSchema, optional, stringProp } from '../schema-helpers';
import { orderSummary } from '../serializers';

interface SetShippingAddressInput {
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
    inputSchema: objectSchema({ address: addressInputSchema }),
})
@Injectable()
export class SetShippingAddressTool implements McpToolHandler<SetShippingAddressInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: SetShippingAddressInput) {
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return { order: null };
        return {
            order: orderSummary(await this.orderService.setShippingAddress(ctx, order.id, input.address)),
        };
    }
}
