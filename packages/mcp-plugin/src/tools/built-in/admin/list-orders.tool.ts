import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { ORDER_SORT_FIELDS, orderListOptions, page, paginationFields } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listOrdersInput = z.strictObject({
    ...paginationFields('orders'),
    sortBy: z
        .enum(ORDER_SORT_FIELDS)
        .describe(
            'Field to sort by. Defaults to orderPlacedAt, which lists the most recently placed ' +
                'orders first. Orders that are still open carts have no orderPlacedAt and sort last.',
        )
        .optional(),
    sortDirection: z.enum(['ASC', 'DESC']).describe('Sort direction. Defaults to DESC.').optional(),
});

type ListOrdersInput = z.infer<typeof listOrdersInput>;

@McpTool({
    name: 'list_orders',
    toolset: 'admin',
    description: 'List orders for operations users, most recently placed first by default.',
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
        const result = await this.orderService.findAll(ctx, orderListOptions(input), ['lines', 'payments']);
        return page(
            result.items.map(order => this.serializer.order(order)),
            result.totalItems,
            input,
        );
    }
}
