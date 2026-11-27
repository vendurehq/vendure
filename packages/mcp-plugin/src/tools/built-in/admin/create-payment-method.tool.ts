import { Injectable } from '@nestjs/common';
import { PaymentMethodService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { paymentMethodFieldsSchema } from './payment-method-fields-schema';
import { toConfigurableOperationInput } from './setup-schemas';

const createPaymentMethodInput = z.strictObject({ input: paymentMethodFieldsSchema });

type CreatePaymentMethodToolInput = z.infer<typeof createPaymentMethodInput>;

@McpTool({
    name: 'create_payment_method',
    toolset: 'admin',
    description:
        'Create a payment method in the active channel. Get valid handler and checker codes and their arguments from list_payment_options.',
    keywords: [
        'accept card payments',
        'add a payment provider',
        'set up checkout payment',
        'enable cash on delivery',
        'connect a payment gateway',
        'new payment method',
    ],
    permissions: [Permission.CreateSettings, Permission.CreatePaymentMethod],
    behavior: 'mutating',
    inputSchema: createPaymentMethodInput,
})
@Injectable()
export class CreatePaymentMethodTool implements McpToolHandler<CreatePaymentMethodToolInput> {
    constructor(
        private readonly paymentMethodService: PaymentMethodService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreatePaymentMethodToolInput) {
        const { checker, handler, enabled, ...fields } = input.input;
        const paymentMethod = await this.paymentMethodService.create(ctx, {
            ...fields,
            enabled: enabled ?? true,
            handler: toConfigurableOperationInput(handler),
            ...(checker ? { checker: toConfigurableOperationInput(checker) } : {}),
        });
        return { paymentMethod: this.serializer.paymentMethod(paymentMethod) };
    }
}
