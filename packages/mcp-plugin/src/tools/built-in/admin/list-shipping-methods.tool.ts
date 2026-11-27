import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, ShippingMethod, ShippingMethodService } from '@vendure/core';
import { listOptions, McpTool, McpToolHandler, page, paginationFields } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listShippingMethodsInput = z.strictObject({
    ...paginationFields('shipping methods'),
});

type ListShippingMethodsInput = z.infer<typeof listShippingMethodsInput>;

@McpTool({
    name: 'list_shipping_methods',
    toolset: 'admin',
    description:
        'List the shipping methods of the active channel, with their eligibility checker, calculator and fulfillment handler.',
    keywords: [
        'how do we ship orders',
        'show delivery options',
        'list shipping rates',
        'which couriers are set up',
        'see postage methods',
        'shipping configuration',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadShippingMethod],
    behavior: 'readonly',
    inputSchema: listShippingMethodsInput,
})
@Injectable()
export class ListShippingMethodsTool implements McpToolHandler<ListShippingMethodsInput> {
    constructor(
        private readonly shippingMethodService: ShippingMethodService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListShippingMethodsInput) {
        const result = await this.shippingMethodService.findAll(ctx, listOptions<ShippingMethod>(input));
        return page(
            result.items.map(method => this.serializer.shippingMethod(method)),
            result.totalItems,
            input,
        );
    }
}
