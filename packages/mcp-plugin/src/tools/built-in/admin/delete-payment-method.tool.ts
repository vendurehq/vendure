import { Injectable } from '@nestjs/common';
import { DEFAULT_CHANNEL_CODE } from '@vendure/common/lib/shared-constants';
import {
    EntityNotFoundError,
    PaymentMethod,
    PaymentMethodService,
    Permission,
    RequestContext,
    TransactionalConnection,
} from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { deletionResult } from './deletion-result';

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
    constructor(
        private readonly paymentMethodService: PaymentMethodService,
        private readonly connection: TransactionalConnection,
    ) {}

    async describe(ctx: RequestContext, input: DeletePaymentMethodToolInput) {
        const method = await this.paymentMethodService.findOne(ctx, input.id);
        if (!method) {
            throw new EntityNotFoundError('PaymentMethod', input.id);
        }
        const name = `payment method "${method.name}" (code ${method.code}, id ${method.id})`;
        // Core only deletes from the default channel. Elsewhere it removes the method from that channel.
        if (ctx.channel.code !== DEFAULT_CHANNEL_CODE) {
            return `Remove ${name} from channel "${ctx.channel.code}". Other channels keep it.`;
        }
        const others = await this.otherChannelCodes(ctx, method);
        if (others.length === 0) {
            return `Delete ${name}.`;
        }
        return input.force
            ? `Delete ${name}, and remove it from the channels that also use it: ${others.join(', ')}.`
            : `Delete ${name}. Channels ${others.join(', ')} also use it, so it is only deleted with force.`;
    }

    async execute(ctx: RequestContext, input: DeletePaymentMethodToolInput) {
        return deletionResult(
            await this.paymentMethodService.delete(ctx, input.id, input.force ?? false),
            `Payment method ${input.id}`,
        );
    }

    private async otherChannelCodes(ctx: RequestContext, method: PaymentMethod): Promise<string[]> {
        const withChannels = await this.connection
            .getRepository(ctx, PaymentMethod)
            .findOne({ where: { id: method.id }, relations: { channels: true } });
        return (withChannels?.channels ?? [])
            .map(channel => channel.code)
            .filter(code => code !== DEFAULT_CHANNEL_CODE)
            .sort((a, b) => a.localeCompare(b));
    }
}
