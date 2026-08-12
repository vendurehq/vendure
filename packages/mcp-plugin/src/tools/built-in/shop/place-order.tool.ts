import { Injectable } from '@nestjs/common';
import { PaymentInput } from '@vendure/common/lib/generated-shop-types';
import { ActiveOrderService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { getActiveOrder, orderResult } from '../order-helpers';

const placeOrderInput = z.strictObject({
    paymentMethodCode: z.string().describe('Payment method code.'),
    paymentMetadata: z.looseObject({}).describe('Metadata passed to the payment handler.').optional(),
});

type PlaceOrderInput = z.infer<typeof placeOrderInput>;

@McpTool({
    name: 'place_order',
    toolset: 'shop',
    description: 'Add payment to the active cart and place the order.',
    keywords: [
        'check out',
        'complete my purchase',
        'pay now',
        'finalize and submit my order',
        'buy everything in my basket',
        'confirm and pay',
    ],
    permissions: [Permission.Public],
    behavior: 'destructive',
    inputSchema: placeOrderInput,
})
@Injectable()
export class PlaceOrderTool implements McpToolHandler<PlaceOrderInput> {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: PlaceOrderInput) {
        if (!ctx.activeUserId) {
            return {
                requiresAuthorization: true,
                message:
                    'Placing an order requires an authorized customer. Complete the OAuth flow ' +
                    'for this store and retry with the resulting access token.',
            };
        }
        const order = await getActiveOrder(ctx, this.activeOrderService, this.orderService, true);
        if (!order) return orderResult(undefined);
        const payment: PaymentInput = {
            method: input.paymentMethodCode,
            metadata: input.paymentMetadata ?? {},
        };
        return orderResult(await this.orderService.addPaymentToOrder(ctx, order.id, payment));
    }
}
