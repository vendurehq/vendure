import { Injectable } from '@nestjs/common';
import { EntityNotFoundError, PaymentMethodService, Permission, RequestContext } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

const deletePaymentMethodInput = z.strictObject({
    id: idSchema.describe('Payment method ID.'),
    force: z
        .boolean()
        .describe('Delete it even when other channels use it, removing it from every channel.')
        .optional(),
});

type DeletePaymentMethodToolInput = z.infer<typeof deletePaymentMethodInput>;

@McpTool({
    name: 'delete_payment_method',
    toolset: 'admin',
    description:
        'Delete a payment method. One that other channels also use is only deleted with force, which removes it from every channel.',
    keywords: [
        'remove a payment option',
        'stop accepting cards',
        'delete a payment provider',
        'drop cash on delivery',
        'remove a payment method',
        'disconnect a payment gateway',
    ],
    permissions: [Permission.DeleteSettings, Permission.DeletePaymentMethod],
    behavior: 'destructive',
    inputSchema: deletePaymentMethodInput,
})
@Injectable()
export class DeletePaymentMethodTool implements McpToolHandler<DeletePaymentMethodToolInput> {
    constructor(private readonly paymentMethodService: PaymentMethodService) {}

    async describe(ctx: RequestContext, input: DeletePaymentMethodToolInput) {
        const paymentMethod = await this.paymentMethodService.findOne(ctx, input.id);
        if (!paymentMethod) {
            throw new EntityNotFoundError('PaymentMethod', input.id);
        }
        const scope = input.force ? ', from every channel that uses it' : '';
        return `Delete payment method "${paymentMethod.name}" (code ${paymentMethod.code}, id ${paymentMethod.id})${scope}.`;
    }

    async execute(ctx: RequestContext, input: DeletePaymentMethodToolInput) {
        return deletionResult(
            await this.paymentMethodService.delete(ctx, input.id, input.force ?? false),
            `Payment method ${input.id}`,
        );
    }
}
