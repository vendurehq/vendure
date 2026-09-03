import { Injectable } from '@nestjs/common';
import { OrderService, OrderState, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';
import { enumString, shortText } from '../string-schemas';

const updateOrderStateInput = z.strictObject({
    id: idSchema.describe('Order ID.'),
    // The state machine decides whether the target state is legal, so any string is accepted
    // here and checked by the transition call in execute().
    state: enumString<OrderState>(
        shortText.describe('Target order state, e.g. "PaymentSettled" or "AddingItems".'),
    ),
});

type UpdateOrderStateInput = z.infer<typeof updateOrderStateInput>;

@McpTool({
    name: 'update_order_state',
    toolset: 'admin',
    description:
        'Transition an order to another state, such as PaymentAuthorized to PaymentSettled, or a ' +
        'checkout between AddingItems and ArrangingPayment. Shipped and Delivered come from ' +
        'create_fulfillment; cancelling is cancel_order.',
    keywords: [
        'change the order status',
        'transition order status',
        'move the order to the next stage',
        'settle the payment on an authorized order',
        'send a stuck checkout back to the cart',
    ],
    permissions: [Permission.UpdateOrder],
    behavior: 'destructive',
    inputSchema: updateOrderStateInput,
})
@Injectable()
export class UpdateOrderStateTool implements McpToolHandler<UpdateOrderStateInput> {
    constructor(
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
    ) {}

    async execute(ctx: RequestContext, input: UpdateOrderStateInput) {
        return this.serializer.orderOrError(
            await this.orderService.transitionToState(ctx, input.id, input.state),
        );
    }
}
