import { Injectable } from '@nestjs/common';
import { OrderService, OrderState, Permission, RequestContext } from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { McpToolSerializerService } from '../serializer.service';

const updateOrderStateInput = z.strictObject({
    id: idSchema.describe('Order ID.'),
    state: z.string().describe('Target order state, e.g. "Shipped" or "Cancelled".'),
});

type UpdateOrderStateInput = z.infer<typeof updateOrderStateInput>;

@McpTool({
    name: 'update_order_state',
    toolset: 'admin',
    description: 'Transition an order to a new state.',
    keywords: [
        'change the order status',
        'mark an order as shipped',
        'move the order to the next stage',
        "advance an order's fulfillment",
        'set the order to complete',
        'transition order status',
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
        // The strict input schema guarantees `state` is a string; the state machine validates that it
        // is a legal target, so we cast the validated string straight to OrderState.
        return this.serializer.orderOrError(
            await this.orderService.transitionToState(ctx, input.id, input.state as OrderState),
        );
    }
}
