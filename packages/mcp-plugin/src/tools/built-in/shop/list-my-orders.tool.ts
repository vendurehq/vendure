import { Injectable } from '@nestjs/common';
import { CustomerService, Order, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { listOptions, page } from '../order-helpers';
import { orderSummary } from '../serializers';

const listMyOrdersInput = z.strictObject({
    limit: z.number().describe('Maximum number of orders to return.').optional(),
    offset: z.number().describe('Number of orders to skip.').optional(),
});

type ListMyOrdersInput = z.infer<typeof listMyOrdersInput> & Record<string, unknown>;

@McpTool({
    name: 'list_my_orders',
    toolset: 'shop',
    description: 'List orders belonging to the authenticated customer.',
    keywords: [
        'my order history',
        'my past purchases',
        "everything I've ordered",
        'show my previous orders',
        'what have I bought before',
        'my buying history',
    ],
    permissions: [Permission.Authenticated],
    behavior: 'readonly',
    inputSchema: listMyOrdersInput,
})
@Injectable()
export class ListMyOrdersTool implements McpToolHandler<ListMyOrdersInput> {
    constructor(
        private customerService: CustomerService,
        private orderService: OrderService,
    ) {}

    async execute(ctx: RequestContext, input: ListMyOrdersInput) {
        if (!ctx.activeUserId) return page([], 0, input);
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) return page([], 0, input);
        const result = await this.orderService.findByCustomerId(ctx, customer.id, listOptions<Order>(input), [
            'lines',
        ]);
        return page(
            result.items.map(order => orderSummary(order)),
            result.totalItems,
            input,
        );
    }
}
