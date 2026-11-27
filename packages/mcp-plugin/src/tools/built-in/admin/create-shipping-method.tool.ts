import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, ShippingMethodService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

import { toConfigurableOperationInput } from './setup-schemas';
import { shippingMethodFieldsSchema } from './shipping-method-fields-schema';

const createShippingMethodInput = z.strictObject({ input: shippingMethodFieldsSchema });

type CreateShippingMethodToolInput = z.infer<typeof createShippingMethodInput>;

@McpTool({
    name: 'create_shipping_method',
    toolset: 'admin',
    description:
        'Create a shipping method in the active channel. Get valid checker, calculator and fulfillment handler codes and their arguments from list_shipping_options.',
    keywords: [
        'add a delivery option',
        'set a flat shipping rate',
        'offer free shipping over an amount',
        'add express postage',
        'create a courier option',
        'new shipping method',
    ],
    permissions: [Permission.CreateSettings, Permission.CreateShippingMethod],
    behavior: 'mutating',
    inputSchema: createShippingMethodInput,
})
@Injectable()
export class CreateShippingMethodTool implements McpToolHandler<CreateShippingMethodToolInput> {
    constructor(
        private readonly shippingMethodService: ShippingMethodService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: CreateShippingMethodToolInput) {
        const { checker, calculator, ...fields } = input.input;
        const shippingMethod = await this.shippingMethodService.create(ctx, {
            ...fields,
            checker: toConfigurableOperationInput(checker),
            calculator: toConfigurableOperationInput(calculator),
        });
        return { shippingMethod: this.serializer.shippingMethod(shippingMethod) };
    }
}
