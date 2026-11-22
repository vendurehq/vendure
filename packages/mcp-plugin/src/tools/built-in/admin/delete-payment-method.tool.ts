import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    EntityNotFoundError,
    PaymentMethodService,
    Permission,
    RequestContext,
    UserInputError,
} from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';
import { quotedCodes } from './preview-text';

const deletePaymentMethodInput = z.strictObject({
    id: idSchema.describe('Payment method ID.'),
    force: z
        .boolean()
        .describe(
            'In the default channel, delete it even when other channels use it, removing it from every channel. ' +
                'Ignored in any other channel.',
        )
        .optional(),
});

type DeletePaymentMethodToolInput = z.infer<typeof deletePaymentMethodInput>;

@McpTool({
    name: 'delete_payment_method',
    toolset: 'admin',
    description:
        'Delete a payment method. In the default channel it is deleted, and one that other channels also use is only ' +
        'deleted with force. In any other channel it is only removed from that channel, and other channels keep it.',
    keywords: [
        'delete a payment method',
        'remove a payment provider for good',
        'delete a payment option',
        'drop cash on delivery',
        'permanently remove a payment method',
        'delete a payment gateway setup',
    ],
    permissions: [Permission.DeleteSettings, Permission.DeletePaymentMethod],
    behavior: 'destructive',
    inputSchema: deletePaymentMethodInput,
})
@Injectable()
export class DeletePaymentMethodTool implements McpToolHandler<DeletePaymentMethodToolInput> {
    constructor(private readonly paymentMethodService: PaymentMethodService) {}

    async describe(ctx: RequestContext, input: DeletePaymentMethodToolInput) {
        const { method, others } = await this.findDeletableMethod(ctx, input);
        const name = `payment method "${method.name}" (code ${method.code}, id ${method.id})`;
        // Core only deletes from the default channel. Elsewhere it removes the method from that channel.
        if (ctx.channel.code !== DEFAULT_CHANNEL_CODE) {
            return `Remove ${name} from channel "${ctx.channel.code}". Other channels keep it.`;
        }
        return others.length
            ? `Delete ${name}, and remove it from the channels that also use it: ${quotedCodes(others)}.`
            : `Delete ${name}.`;
    }

    async execute(ctx: RequestContext, input: DeletePaymentMethodToolInput) {
        await this.findDeletableMethod(ctx, input);
        return deletionResult(
            await this.paymentMethodService.delete(ctx, input.id, input.force ?? false),
            `Payment method ${input.id}`,
        );
    }

    /**
     * In the default channel, core refuses a method that other channels use unless `force` is set, so that
     * case is refused before the caller is asked to consent to it.
     */
    private async findDeletableMethod(ctx: RequestContext, input: DeletePaymentMethodToolInput) {
        const method = await this.paymentMethodService.findOne(ctx, input.id, ['channels']);
        if (!method) {
            throw new EntityNotFoundError('PaymentMethod', input.id);
        }
        const others = (method.channels ?? []).filter(channel => channel.code !== DEFAULT_CHANNEL_CODE);
        if (ctx.channel.code === DEFAULT_CHANNEL_CODE && others.length && !input.force) {
            throw new UserInputError(
                `Payment method "${method.code}" is also used by channels ${quotedCodes(others)}. ` +
                    'Pass "force": true to delete it from every channel.',
            );
        }
        return { method, others };
    }
}
