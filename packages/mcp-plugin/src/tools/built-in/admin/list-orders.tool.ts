import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext, TranslatorService } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import {
    booleanFilter,
    dateFilter,
    numberFilter,
    page,
    paginationFields,
    stringFilter,
} from '../list-helpers';
import {
    ORDER_LIST_RELATIONS,
    ORDER_SORT_FIELDS,
    orderListOptions,
    translateLineVariants,
} from '../order-list-helpers';
import { McpToolSerializerService } from '../serializer.service';

const listOrdersInput = z.strictObject({
    ...paginationFields('orders'),
    filter: z
        .strictObject({
            code: stringFilter.optional(),
            state: stringFilter
                .describe('Order state, for example PaymentSettled or ArrangingPayment.')
                .optional(),
            active: booleanFilter
                .describe('true for open carts, false for placed or cancelled orders.')
                .optional(),
            customerLastName: stringFilter.optional(),
            orderPlacedAt: dateFilter.optional(),
            updatedAt: dateFilter.optional(),
            totalWithTax: numberFilter
                .describe(
                    "Whole number in the currency's smallest unit, like every price these tools return.",
                )
                .optional(),
        })
        .describe(
            'Conditions an order must meet; all of them apply together. Example: ' +
                '{"state":{"eq":"ArrangingPayment"},"updatedAt":{"before":"2026-08-25T12:00:00Z"}} ' +
                'finds orders stuck at payment since before noon.',
        )
        .optional(),
    sortBy: z
        .enum(ORDER_SORT_FIELDS)
        .describe(
            'Field to sort by. Defaults to updatedAt, most recently changed first. Open carts have ' +
                'no orderPlacedAt, so when sorting by it filter active: false to see placed orders only.',
        )
        .optional(),
    sortDirection: z.enum(['ASC', 'DESC']).describe('Sort direction. Defaults to DESC.').optional(),
});

type ListOrdersInput = z.infer<typeof listOrdersInput>;

@McpTool({
    name: 'list_orders',
    toolset: 'admin',
    description: 'List and filter orders for operations users, most recently updated first by default.',
    keywords: [
        'show all orders',
        'recent orders in the store',
        'browse the order queue',
        'every order placed',
        'orders dashboard for staff',
        'pull the full order list',
        'orders in a given state',
        'find orders by customer last name',
    ],
    permissions: [Permission.ReadOrder],
    behavior: 'readonly',
    inputSchema: listOrdersInput,
})
@Injectable()
export class ListOrdersTool implements McpToolHandler<ListOrdersInput> {
    constructor(
        private orderService: OrderService,
        private translator: TranslatorService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: ListOrdersInput) {
        const result = await this.orderService.findAll(
            ctx,
            orderListOptions(input, 'updatedAt'),
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
