import { Injectable } from '@nestjs/common';
import {
    ConfigArgService,
    EntityNotFoundError,
    PaymentMethodService,
    Permission,
    RequestContext,
} from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { keepOmittedSecretArgs, secretConfigArgsOf } from '../../../config-arg-secrets';
import { McpToolSerializerService } from '../serializer.service';

import { paymentMethodFieldsSchema } from './payment-method-fields-schema';
import { toConfigurableOperationInput } from './setup-schemas';

const updatePaymentMethodInput = z.strictObject({
    id: idSchema.describe('Payment method ID.'),
    input: paymentMethodFieldsSchema.partial(),
});

type UpdatePaymentMethodToolInput = z.infer<typeof updatePaymentMethodInput>;

@McpTool({
    name: 'update_payment_method',
    toolset: 'admin',
    description:
        "Change a payment method's code, names, enabled state, handler or checker. " +
        'Only the fields given change. ' +
        'To keep a secret argument, send back the placeholder value list_payment_methods returned for it.',
    keywords: [
        'disable a payment method',
        'change payment provider settings',
        'edit checkout payment',
        'rename a payment option',
        'update payment handler arguments',
        'turn off card payments',
    ],
    permissions: [Permission.UpdateSettings, Permission.UpdatePaymentMethod],
    behavior: 'mutating',
    inputSchema: updatePaymentMethodInput,
})
@Injectable()
export class UpdatePaymentMethodTool implements McpToolHandler<UpdatePaymentMethodToolInput> {
    constructor(
        private readonly paymentMethodService: PaymentMethodService,
        private readonly configArgService: ConfigArgService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdatePaymentMethodToolInput) {
        const { translations, ...fields } = input.input;
        const stored = await this.paymentMethodService.findOne(ctx, input.id);
        if (!stored) {
            throw new EntityNotFoundError('PaymentMethod', input.id);
        }
        const isSecret = secretConfigArgsOf(this.configArgService);
        const handler = fields.handler && keepOmittedSecretArgs(fields.handler, stored.handler, isSecret);
        const checker = fields.checker && keepOmittedSecretArgs(fields.checker, stored.checker, isSecret);
        const paymentMethod = await this.paymentMethodService.update(ctx, {
            code: fields.code,
            enabled: fields.enabled,
            id: input.id,
            translations: translations ?? [],
            ...(handler ? { handler: toConfigurableOperationInput(handler) } : {}),
            ...(checker ? { checker: toConfigurableOperationInput(checker) } : {}),
            // Core removes the checker when it receives null, which the generated input type leaves out.
            ...(checker === null ? { checker: null as unknown as undefined } : {}),
        });
        return { paymentMethod: this.serializer.paymentMethod(paymentMethod) };
    }
}
