import { Injectable } from '@nestjs/common';
import { PaymentInput } from '@vendure/common/lib/generated-shop-types';
import {
    isGraphQlErrorResult,
    OrderService,
    Permission,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpActiveOrderService } from '../active-order.service';
import { McpToolSerializerService } from '../serializer.service';

const placeOrderInput = z.strictObject({
    paymentMethodCode: z.string().describe('Payment method code.'),
    paymentMetadata: z.looseObject({}).describe('Metadata passed to the payment handler.').optional(),
});

type PlaceOrderInput = z.infer<typeof placeOrderInput>;

@McpTool({
    name: 'place_order',
    toolset: 'shop',
    description:
        'Place the order: move the active cart to the payment stage if it is still open, then add ' +
        'payment. The cart needs a shipping method and enough stock first.',
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
        private activeOrder: McpActiveOrderService,
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
        private connection: TransactionalConnection,
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
        // Taking a payment has to run inside a database transaction: `addPaymentToOrder` refuses to
        // run without one.
        return this.connection.withTransaction(ctx, async txCtx => {
            const order = await this.activeOrder.findOrCreate(txCtx);

            const current = await this.orderService.findOne(txCtx, order.id);
            let movedOutOfCart = false;
            if (current?.state === 'AddingItems') {
                const transition = await this.orderService.transitionToState(
                    txCtx,
                    order.id,
                    'ArrangingPayment',
                );
                if (isGraphQlErrorResult(transition)) {
                    return this.serializer.orderOrError(transition);
                }
                movedOutOfCart = true;
            }

            const payment: PaymentInput = {
                method: input.paymentMethodCode,
                metadata: input.paymentMetadata ?? {},
            };
            const result = await this.orderService.addPaymentToOrder(txCtx, order.id, payment);

            if (isGraphQlErrorResult(result) && movedOutOfCart) {
                await this.orderService.transitionToState(txCtx, order.id, 'AddingItems');
            }
            return this.serializer.orderOrError(result);
        });
    }
}
