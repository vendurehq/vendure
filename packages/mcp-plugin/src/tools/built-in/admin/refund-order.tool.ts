import { Injectable } from '@nestjs/common';
import { ID, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { idProp, numberProp, objectSchema, optional, stringProp } from '../schema-helpers';

interface RefundOrderToolInput {
    id: ID;
    amount?: number;
    reason?: string;
    paymentId?: ID;
}

@McpTool({
    name: 'refund_order',
    toolset: 'admin',
    description: 'Refund the first refundable payment for an order.',
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
    inputSchema: objectSchema({
        id: idProp('Order ID.'),
        amount: optional(
            numberProp('Amount to refund in minor units. Defaults to the order total with tax.'),
        ),
        reason: optional(stringProp('Reason for the refund.')),
        paymentId: optional(idProp('Payment to refund. Defaults to the first payment on the order.')),
    }),
})
@Injectable()
export class RefundOrderTool implements McpToolHandler<RefundOrderToolInput> {
    constructor(private orderService: OrderService) {}

    async execute(ctx: RequestContext, input: RefundOrderToolInput) {
        const order = await this.orderService.findOne(ctx, input.id, ['payments', 'payments.refunds']);
        const paymentId = input.paymentId ?? order?.payments?.[0]?.id;
        if (!paymentId) {
            return {
                result: {
                    __typename: 'RefundPaymentIdMissingError',
                    message: 'No payment is available to refund.',
                },
            };
        }
        return {
            result: await this.orderService.refundOrder(ctx, {
                paymentId,
                amount: input.amount ?? order?.totalWithTax ?? 0,
                reason: input.reason,
            }),
        };
    }
}
