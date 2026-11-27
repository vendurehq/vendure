import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler, shortText } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { McpToolSerializerService } from '../serializer.service';

const setShippingMethodInput = z.strictObject({
    methodId: idSchema.describe('Shipping method ID.'),
    optionCode: shortText
        .describe(
            'The code of one of the options listed for this method by get_eligible_shipping_methods, ' +
                'e.g. a carrier service. Omit to use the cheapest option.',
        )
        .optional(),
});

type SetShippingMethodInput = z.infer<typeof setShippingMethodInput>;

@McpTool({
    name: 'set_shipping_method',
    toolset: 'shop',
    description:
        'Set the shipping method for the active cart. A method may offer several options, such as ' +
        'carrier services; pass optionCode to choose one, or omit it for the cheapest.',
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
    usesActiveOrder: true,
    inputSchema: setShippingMethodInput,
})
@Injectable()
export class SetShippingMethodTool implements McpToolHandler<SetShippingMethodInput> {
    constructor(
        private readonly activeOrder: McpActiveOrderService,
        private readonly orderService: OrderService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: SetShippingMethodInput) {
        const order = await this.activeOrder.findOrThrow(ctx);
        return this.serializer.orderOrError(
            await this.orderService.setShippingMethod(ctx, order.id, [
                { shippingMethodId: input.methodId, shippingOptionCode: input.optionCode },
            ]),
        );
    }
}
