import { Injectable } from '@nestjs/common';
import { CustomerService, Order, OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { listOptions, page, paginationFields } from '../order-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listMyOrdersInput = z.strictObject({
    ...paginationFields('orders'),
});

type ListMyOrdersInput = z.infer<typeof listMyOrdersInput>;

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
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListMyOrdersInput) {
        if (!ctx.activeUserId) return page([], 0, input);
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) return page([], 0, input);
        const result = await this.orderService.findByCustomerId(ctx, customer.id, listOptions<Order>(input), [
            'lines',
        ]);
        return page(
            result.items.map(order => this.serializer.order(order)),
            result.totalItems,
            input,
        );
    }
}
