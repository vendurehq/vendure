import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, ShippingMethodService } from '@vendure/core';
import { idSchema, McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { toConfigurableOperationInput } from './setup-schemas';
import { shippingMethodFieldsSchema } from './shipping-method-fields-schema';

const updateShippingMethodInput = z.strictObject({
    id: idSchema.describe('Shipping method ID.'),
    input: shippingMethodFieldsSchema.partial(),
});

type UpdateShippingMethodToolInput = z.infer<typeof updateShippingMethodInput>;

@McpTool({
    name: 'update_shipping_method',
    toolset: 'admin',
    description:
        "Change a shipping method's code, names, checker, calculator or fulfillment handler. " +
        'Only the fields given change. ' +
        'A checker or calculator replaces the old one with all its arguments.',
    keywords: [
        'change the shipping price',
        'edit a delivery option',
        'raise the free shipping threshold',
        'rename a shipping method',
        'update postage rates',
        'modify shipping eligibility',
    ],
    permissions: [Permission.UpdateSettings, Permission.UpdateShippingMethod],
    behavior: 'mutating',
    inputSchema: updateShippingMethodInput,
})
@Injectable()
export class UpdateShippingMethodTool implements McpToolHandler<UpdateShippingMethodToolInput> {
    constructor(
        private readonly shippingMethodService: ShippingMethodService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateShippingMethodToolInput) {
        const { checker, calculator, translations, ...fields } = input.input;
        const shippingMethod = await this.shippingMethodService.update(ctx, {
            ...fields,
            id: input.id,
            translations: translations ?? [],
            ...(checker ? { checker: toConfigurableOperationInput(checker) } : {}),
            ...(calculator ? { calculator: toConfigurableOperationInput(calculator) } : {}),
        });
        return { shippingMethod: this.serializer.shippingMethod(shippingMethod) };
    }
}
