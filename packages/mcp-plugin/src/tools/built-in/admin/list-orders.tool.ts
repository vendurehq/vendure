import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';

import { orderListOptions, page } from '../order-helpers';
import { numberProp, objectSchema, optional } from '../schema-helpers';
import { orderSummary } from '../serializers';

interface ListOrdersInput extends Record<string, unknown> {
    limit?: number;
    offset?: number;
}

@McpTool({
    name: 'list_orders',
    toolset: 'admin',
    description: 'List orders for operations users.',
    keywords: [
        'show all orders',
        'recent orders in the store',
        'browse the order queue',
        'every order placed',
        'orders dashboard for staff',
        'pull the full order list',
    ],
    permissions: [Permission.ReadOrder],
    behavior: 'readonly',
    inputSchema: objectSchema({
        limit: optional(numberProp('Maximum number of orders to return.')),
        offset: optional(numberProp('Number of orders to skip.')),
    }),
})
@Injectable()
export class ListOrdersTool implements McpToolHandler<ListOrdersInput> {
    constructor(private orderService: OrderService) {}

    async execute(ctx: RequestContext, input: ListOrdersInput) {
        const result = await this.orderService.findAll(ctx, orderListOptions(input), ['lines']);
        return page(
            result.items.map(order => orderSummary(order)),
            result.totalItems,
            input,
        );
    }
}
