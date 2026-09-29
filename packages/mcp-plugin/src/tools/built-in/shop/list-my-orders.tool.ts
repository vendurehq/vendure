import { Injectable } from '@nestjs/common';
import { CustomerService, OrderService, Permission, RequestContext, TranslatorService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { page, paginationFields } from '../list-helpers';
import { ORDER_LIST_RELATIONS, orderListOptions, translateLineVariants } from '../order-list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listMyOrdersInput = z.strictObject({
    ...paginationFields('orders'),
});

type ListMyOrdersInput = z.infer<typeof listMyOrdersInput>;

@McpTool({
    name: 'list_my_orders',
    toolset: 'shop',
    description: 'List orders belonging to the authenticated customer, newest first.',
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
        private readonly customerService: CustomerService,
        private readonly orderService: OrderService,
        private readonly translator: TranslatorService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListMyOrdersInput) {
        if (!ctx.activeUserId) return page([], 0, input);
        const customer = await this.customerService.findOneByUserId(ctx, ctx.activeUserId);
        if (!customer) return page([], 0, input);
        const result = await this.orderService.findByCustomerId(
            ctx,
            customer.id,
            orderListOptions(input, 'createdAt'),
            ORDER_LIST_RELATIONS,
        );
        translateLineVariants(result.items, this.translator, ctx);
        return page(
            result.items.map(order => this.serializer.order(order)),
            result.totalItems,
            input,
        );
    }
}
