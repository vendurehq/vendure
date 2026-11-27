import { Injectable } from '@nestjs/common';
import { PaymentMethod, PaymentMethodService, Permission, RequestContext } from '@vendure/core';
import { listOptions, McpTool, McpToolHandler, page, paginationFields } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listPaymentMethodsInput = z.strictObject({
    ...paginationFields('payment methods'),
});

type ListPaymentMethodsInput = z.infer<typeof listPaymentMethodsInput>;

@McpTool({
    name: 'list_payment_methods',
    toolset: 'admin',
    description:
        'List the payment methods of the active channel, with their handler, eligibility checker and enabled state. Secret arguments are never shown.',
    keywords: [
        'how can customers pay',
        'show payment options',
        'which payment providers are set up',
        'is card payment enabled',
        'list checkout payment methods',
        'payment configuration',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadPaymentMethod],
    behavior: 'readonly',
    inputSchema: listPaymentMethodsInput,
})
@Injectable()
export class ListPaymentMethodsTool implements McpToolHandler<ListPaymentMethodsInput> {
    constructor(
        private readonly paymentMethodService: PaymentMethodService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListPaymentMethodsInput) {
        const result = await this.paymentMethodService.findAll(ctx, listOptions<PaymentMethod>(input));
        return page(
            result.items.map(method => this.serializer.paymentMethod(method)),
            result.totalItems,
            input,
        );
    }
}
