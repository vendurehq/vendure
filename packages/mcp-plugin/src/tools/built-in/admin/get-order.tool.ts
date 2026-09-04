import { Injectable } from '@nestjs/common';
import { OrderService, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { ORDER_DETAIL_RELATIONS } from '../order-list-helpers';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

const getOrderInput = z
    .strictObject({
        id: idSchema.describe('Order ID. Pass this or code, not both.').optional(),
        code: shortText.describe('Order code, used when ID is omitted.').optional(),
    })
    .refine(input => (input.id != null) !== (input.code != null), {
        message: 'Pass exactly one of id or code.',
    });

type GetOrderInput = z.infer<typeof getOrderInput>;

// `get_order` exists in both toolsets, so this class gets its own name rather than reusing the shop
// `ShopGetOrderTool`. A distinct class means stack traces and editor symbol search point at the right one.
@McpTool({
    name: 'get_order',
    toolset: 'admin',
    description: 'Get an order by ID or code, with its lines, customer and payments.',
    keywords: [
        'look up an order in the back office',
        'pull up order details for support',
        'inspect a single order',
        'open an order record by id or code',
        'view an order as staff',
        'fetch order info for operations',
    ],
    permissions: [Permission.ReadOrder],
    behavior: 'readonly',
    inputSchema: getOrderInput,
})
@Injectable()
export class AdminGetOrderTool implements McpToolHandler<GetOrderInput> {
    constructor(
        private readonly orderService: OrderService,
        private readonly serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: GetOrderInput) {
        const lookup = input.id != null ? `id ${String(input.id)}` : `code ${String(input.code)}`;
        const order =
            input.id != null
                ? await this.orderService.findOne(ctx, input.id, ORDER_DETAIL_RELATIONS)
                : await this.orderService.findOneByCode(ctx, input.code as string, ORDER_DETAIL_RELATIONS);
        if (order) {
            return { order: this.serializer.order(order) };
        }
        return { order: null, message: `No order with ${lookup}` };
    }
}
