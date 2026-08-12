import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { orderListOptions, page } from '../order-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listOrdersInput = z.strictObject({
    limit: z.number().describe('Maximum number of orders to return.').optional(),
    offset: z.number().describe('Number of orders to skip.').optional(),
});

type ListOrdersInput = z.infer<typeof listOrdersInput> & Record<string, unknown>;

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
    inputSchema: listOrdersInput,
})
@Injectable()
export class ListOrdersTool implements McpToolHandler<ListOrdersInput> {
    constructor(
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListOrdersInput) {
        const result = await this.orderService.findAll(ctx, orderListOptions(input), ['lines']);
        return page(
            result.items.map(order => this.serializer.order(order)),
            result.totalItems,
            input,
        );
    }
}
