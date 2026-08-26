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
        'Add payment to the active cart and place the order. Requires a shipping method and enough ' +
        'stock. Returns "placed" or "awaiting_payment" with payment details.',
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
    usesActiveOrder: true,
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
        const order = await this.activeOrder.findOrThrow(ctx);
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
        return this.connection.withTransaction(order.ctx, async txCtx => {
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

            if (isGraphQlErrorResult(result)) {
                if (movedOutOfCart) {
                    await this.orderService.transitionToState(txCtx, order.id, 'AddingItems');
                }
                return this.serializer.orderOrError(result);
            }

            result.payments = await this.orderService.getOrderPayments(txCtx, result.id);

            if (result.orderPlacedAt) {
                return { status: 'placed' as const, order: this.serializer.order(result) };
            }

            let message =
                'Payment was created, but the order is not placed yet. Look at order.payments for ' +
                "each payment's state and any publicMetadata with the shopper's next step.";
            if (result.state === 'ArrangingPayment') {
                message += ' The cart cannot be edited while the order is in ArrangingPayment.';
            }
            return {
                status: 'awaiting_payment' as const,
                order: this.serializer.order(result),
                message,
            };
        });
    }
}
