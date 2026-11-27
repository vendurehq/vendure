import { Injectable } from '@nestjs/common';
import { PaymentMethodService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listPaymentOptionsInput = z.strictObject({});

type ListPaymentOptionsInput = z.infer<typeof listPaymentOptionsInput>;

@McpTool({
    name: 'list_payment_options',
    toolset: 'admin',
    description:
        'List the payment handlers and eligibility checkers a payment method can use, with the arguments each takes. ' +
        'Use the codes in create_payment_method and update_payment_method.',
    keywords: [
        'which payment providers can I add',
        'what arguments does a payment handler need',
        'list payment integrations',
        'available payment plugins',
        'payment checker types',
        'how can customers be charged',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadPaymentMethod],
    behavior: 'readonly',
    inputSchema: listPaymentOptionsInput,
})
@Injectable()
export class ListPaymentOptionsTool implements McpToolHandler<ListPaymentOptionsInput> {
    constructor(
        private readonly paymentMethodService: PaymentMethodService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    execute(ctx: RequestContext) {
        const serialize = this.serializer.configurableOperationDefinition.bind(this.serializer);
        return {
            handlers: this.paymentMethodService.getPaymentMethodHandlers(ctx).map(serialize),
            eligibilityCheckers: this.paymentMethodService
                .getPaymentMethodEligibilityCheckers(ctx)
                .map(serialize),
        };
    }
}
