import { Injectable } from '@nestjs/common';
import { summate } from '@vendure/common/lib/shared-utils';
import { idsAreEqual, OrderService, Payment, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';

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

function getRefundableAmount(payment: Payment): number {
    const activeRefunds = payment.refunds?.filter(refund => refund.state !== 'Failed') ?? [];
    return payment.amount - summate(activeRefunds, 'total');
}

@McpTool({
    name: 'refund_order',
    toolset: 'admin',
    description:
        "Refund an order's first Settled payment that still has a refundable amount, for that payment's remaining refundable amount.",
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
    constructor(private orderService: OrderService) {}

    async execute(ctx: RequestContext, input: RefundOrderToolInput) {
        const order = await this.orderService.findOne(ctx, input.id, ['payments', 'payments.refunds']);
        const payments = order?.payments ?? [];

        const payment = input.paymentId
            ? payments.find(p => idsAreEqual(p.id, input.paymentId))
            : payments.find(p => p.state === 'Settled' && getRefundableAmount(p) > 0);

        if (!payment) {
            return {
                result: {
                    __typename: 'RefundPaymentIdMissingError',
                    errorCode: 'REFUND_PAYMENT_ID_MISSING_ERROR',
                    message: input.paymentId
                        ? 'The requested payment was not found on this order.'
                        : 'No payment is available to refund.',
                },
            };
        }
        return {
            result: await this.orderService.refundOrder(ctx, {
                paymentId: payment.id,
                amount: input.amount ?? getRefundableAmount(payment),
                reason: input.reason,
                shipping: 0,
                adjustment: 0,
            }),
        };
    }
}
