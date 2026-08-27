import { Injectable } from '@nestjs/common';
import { summate } from '@vendure/common/lib/shared-utils';
import {
    EntityNotFoundError,
    idsAreEqual,
    isGraphQlErrorResult,
    Order,
    OrderService,
    Payment,
    Permission,
    Refund,
    RequestContext,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const refundOrderInput = z.strictObject({
    id: idSchema.describe('Order ID.'),
    amount: z
        .number()
        .describe(
            "Amount to refund in minor units. Defaults to the selected payment's remaining refundable amount.",
        )
        .optional(),
    reason: z.string().describe('Reason for the refund.').optional(),
    paymentId: idSchema
        .describe(
            "Payment to refund; must belong to this order. Defaults to the order's first Settled payment that still has a refundable amount.",
        )
        .optional(),
});

type RefundOrderToolInput = z.infer<typeof refundOrderInput>;

/** The refunds that count against a payment: a Failed refund returned no money. */
function countedRefunds(payment: Payment): Refund[] {
    return payment.refunds?.filter(refund => refund.state !== 'Failed') ?? [];
}

function getRefundableAmount(payment: Payment): number {
    return payment.amount - summate(countedRefunds(payment), 'total');
}

@McpTool({
    name: 'refund_order',
    toolset: 'admin',
    description:
        "Refund part or all of an order's payment. With amount, refunds that amount; without it, refunds " +
        'the remaining refundable amount of the first Settled payment. Pass paymentId to pick a payment ' +
        'when the order has several.',
    keywords: [
        'give the customer their money back',
        'issue a refund',
        'return the payment',
        'reimburse a buyer',
        'pay back an order',
        'process a refund',
    ],
    permissions: [Permission.UpdateOrder],
    behavior: 'destructive',
    inputSchema: refundOrderInput,
})
@Injectable()
export class RefundOrderTool implements McpToolHandler<RefundOrderToolInput> {
    constructor(
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: RefundOrderToolInput) {
        const order = await this.orderService.findOne(ctx, input.id, ['payments', 'payments.refunds']);
        if (!order) {
            throw new EntityNotFoundError('Order', input.id);
        }

        const payment = input.paymentId
            ? order.payments.find(p => idsAreEqual(p.id, input.paymentId))
            : order.payments.find(p => p.state === 'Settled' && getRefundableAmount(p) > 0);

        if (!payment) {
            // A bare Vendure error result: the registry reports it as a failed call.
            return {
                __typename: 'RefundPaymentIdMissingError',
                errorCode: 'REFUND_PAYMENT_ID_MISSING_ERROR',
                message: input.paymentId
                    ? 'The requested payment was not found on this order.'
                    : this.nothingToRefundMessage(order),
            };
        }
        const refund = await this.orderService.refundOrder(ctx, {
            paymentId: payment.id,
            amount: input.amount ?? getRefundableAmount(payment),
            reason: input.reason,
            shipping: 0,
            adjustment: 0,
        });
        return isGraphQlErrorResult(refund)
            ? refund
            : { refund: this.serializer.refund(refund, order.currencyCode) };
    }

    /** Why no payment was picked: the first Settled payment is already refunded, or there is none. */
    private nothingToRefundMessage(order: Order): string {
        const settled = order.payments.find(p => p.state === 'Settled');
        if (!settled) {
            return `Order ${order.code} has no Settled payment to refund.`;
        }
        const refunds = countedRefunds(settled);
        const refunded = this.serializer.decimal(summate(refunds, 'total'));
        const states = refunds.map(refund => refund.state).join(', ');
        return (
            `Payment ${String(settled.id)} has no refundable amount left: ${refunded} of ` +
            `${this.serializer.decimal(settled.amount)} already refunded (${states}).`
        );
    }
}
