import { Injectable } from '@nestjs/common';
import { ConfigService, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool } from '@vendure/mcp-sdk';

import { McpPluginToolHandler } from '../../../types';
import { objectSchema, stringProp } from '../schema-helpers';
import { orderSummary } from '../serializers';

interface GetOrderInput {
    code: string;
}

@McpTool({
    name: 'get_order',
    toolset: 'shop',
    description: 'Get an accessible order by code.',
    keywords: [
        'track my order',
        'where is my package',
        'check my order status',
        'look up my purchase by number',
        'find my order with the reference',
        'how is my delivery going',
    ],
    permissions: [Permission.Public],
    behavior: 'readonly',
    inputSchema: objectSchema({ code: stringProp('Order code.') }),
})
@Injectable()
export class ShopGetOrderTool implements McpPluginToolHandler<GetOrderInput> {
    constructor(
        private configService: ConfigService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: GetOrderInput) {
        const order = await this.orderService.findOneByCode(ctx, input.code, [
            'lines',
            'customer',
            'customer.user',
        ]);
        if (!order) return { order: null };
        const canAccess = await this.configService.orderOptions.orderByCodeAccessStrategy.canAccessOrder(
            ctx,
            order,
        );
        return { order: canAccess ? orderSummary(order) : null };
    }
}
