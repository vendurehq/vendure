import { Injectable } from '@nestjs/common';
import { Permission, RequestContext, ShippingMethodService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { McpToolSerializerService } from '../serializer.service';

const listShippingOptionsInput = z.strictObject({});

type ListShippingOptionsInput = z.infer<typeof listShippingOptionsInput>;

@McpTool({
    name: 'list_shipping_options',
    toolset: 'admin',
    description:
        'List the eligibility checkers, calculators and fulfillment handlers a shipping method can use, with the arguments each takes. ' +
        'Use the codes in create_shipping_method and update_shipping_method.',
    keywords: [
        'what shipping calculators are available',
        'which arguments does a shipping checker take',
        'list fulfillment handlers',
        'shipping rule types',
        'how can shipping be priced',
        'available shipping plugins',
    ],
    permissions: [Permission.ReadSettings, Permission.ReadShippingMethod],
    behavior: 'readonly',
    inputSchema: listShippingOptionsInput,
})
@Injectable()
export class ListShippingOptionsTool implements McpToolHandler<ListShippingOptionsInput> {
    constructor(
        private readonly shippingMethodService: ShippingMethodService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    execute(ctx: RequestContext) {
        const serialize = this.serializer.configurableOperationDefinition.bind(this.serializer);
        return {
            eligibilityCheckers: this.shippingMethodService
                .getShippingEligibilityCheckers(ctx)
                .map(serialize),
            calculators: this.shippingMethodService.getShippingCalculators(ctx).map(serialize),
            fulfillmentHandlers: this.shippingMethodService.getFulfillmentHandlers(ctx).map(serialize),
        };
    }
}
