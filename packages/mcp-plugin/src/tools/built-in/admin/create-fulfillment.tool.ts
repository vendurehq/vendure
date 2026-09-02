import { Injectable } from '@nestjs/common';
import { OrderLineInput } from '@vendure/common/lib/generated-types';
import {
    EntityNotFoundError,
    Fulfillment,
    FulfillmentState,
    FulfillmentStateTransitionError,
    ID,
    idsAreEqual,
    isGraphQlErrorResult,
    manualFulfillmentHandler,
    Order,
    OrderService,
    Permission,
    RequestContext,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { McpTool, McpToolHandler } from '@vendure/mcp-sdk';
import { z } from 'zod';

import { idSchema } from '../id-schema';
import { int32Schema } from '../int32-schema';
import { ORDER_DETAIL_RELATIONS } from '../list-helpers';
import { McpToolSerializerService } from '../serializer.service';
import { shortText } from '../string-schemas';

const createFulfillmentInput = z.strictObject({
    id: idSchema.describe('Order ID.'),
    method: shortText.describe('Shipping method or carrier name to record on the fulfillment.'),
    trackingCode: shortText.describe("The carrier's tracking code for this shipment.").optional(),
    lines: z
        .array(
            z.strictObject({
                orderLineId: idSchema.describe('Order line ID, as returned by get_order.'),
                quantity: int32Schema
                    .min(1)
                    .describe('How many of that line to fulfill, a whole number of at least 1.'),
            }),
        )
        .describe('Lines to fulfill. Omit to fulfill every line in the quantity still unfulfilled.')
        .optional(),
    state: z
        .enum(['Shipped', 'Delivered'])
        .describe(
            'Move the new fulfillment straight to this state. Shipped makes the order Shipped or ' +
                'PartiallyShipped; Delivered makes it Delivered or PartiallyDelivered.',
        )
        .optional(),
});

type CreateFulfillmentInput = z.infer<typeof createFulfillmentInput>;

class RefusedTransition extends Error {
    constructor(readonly result: FulfillmentStateTransitionError) {
        super(result.message);
    }
}

@McpTool({
    name: 'create_fulfillment',
    toolset: 'admin',
    description:
        "Create a fulfillment for some or all of an order's lines. Without state, the fulfillment " +
        'is Pending and the order state does not change.',
    keywords: [
        'fulfil an order',
        'fulfill the items in an order',
        'mark an order as shipped',
        'dispatch an order to the customer',
        'add a tracking code to an order',
        'record a shipment for an order',
    ],
    permissions: [Permission.UpdateOrder],
    // Fulfilling writes Sale stock movements, and with `state` it carries the order to Shipped or
    // Delivered. No built-in tool undoes either, so this asks for a confirmation like adjust_stock.
    behavior: 'destructive',
    inputSchema: createFulfillmentInput,
})
@Injectable()
export class CreateFulfillmentTool implements McpToolHandler<CreateFulfillmentInput> {
    constructor(
        private orderService: OrderService,
        private serializer: McpToolSerializerService,
        private connection: TransactionalConnection,
    ) {}

    async execute(ctx: RequestContext, input: CreateFulfillmentInput) {
        const order = await this.orderService.findOne(ctx, input.id, ORDER_DETAIL_RELATIONS);
        if (!order) {
            throw new EntityNotFoundError('Order', input.id);
        }
        const lines = input.lines ? this.linesOfOrder(order, input.lines) : unfulfilledLines(order);
        try {
            // Creating the fulfillment, moving it on and reading the result back are one unit of
            // work, so a refused transition leaves no fulfillment behind.
            return await this.connection.withTransaction(ctx, async txCtx => {
                const created = await this.orderService.createFulfillment(txCtx, {
                    lines,
                    handler: {
                        code: manualFulfillmentHandler.code,
                        arguments: [
                            { name: 'method', value: input.method },
                            { name: 'trackingCode', value: input.trackingCode ?? '' },
                        ],
                    },
                });
                if (isGraphQlErrorResult(created)) {
                    return created;
                }
                const fulfillment = input.state
                    ? await this.transitionOrThrow(txCtx, created.id, input.state)
                    : created;
                const updated = await this.orderService.findOne(txCtx, input.id, ORDER_DETAIL_RELATIONS);
                return {
                    fulfillment: this.serializer.fulfillment(
                        fulfillment,
                        updated?.fulfillments?.find(item => idsAreEqual(item.id, fulfillment.id))?.lines ??
                            [],
                    ),
                    order: this.serializer.order(updated),
                };
            });
        } catch (e) {
            if (e instanceof RefusedTransition) {
                return e.result;
            }
            throw e;
        }
    }

    private async transitionOrThrow(
        ctx: RequestContext,
        fulfillmentId: ID,
        state: FulfillmentState,
    ): Promise<Fulfillment> {
        const result = await this.orderService.transitionFulfillmentToState(ctx, fulfillmentId, state);
        if (isGraphQlErrorResult(result)) {
            throw new RefusedTransition(result);
        }
        return result;
    }

    /**
     * The caller's lines, once every one of them is confirmed to be on the named order.
     *
     * `OrderService.createFulfillment` takes no order id: it works out which orders to fulfill from
     * the line ids alone. So without this check, naming one order and passing another order's line
     * would fulfill that other order while the answer showed the named one.
     */
    private linesOfOrder(order: Order, lines: OrderLineInput[]): OrderLineInput[] {
        for (const line of lines) {
            if (!order.lines.some(orderLine => idsAreEqual(orderLine.id, line.orderLineId))) {
                throw new UserInputError(
                    `Order line ${String(line.orderLineId)} is not on order ${String(order.id)}.`,
                );
            }
        }
        return lines;
    }
}

/**
 * Every line of the order with the quantity that no live fulfillment already covers. This is the
 * rule core applies in its own `requestedFulfillmentQuantityExceedsLineQuantity` check when a caller
 * names the lines: a fulfillment in the Cancelled state does not count, so cancelling one frees its
 * quantity again. The order arrives with `fulfillments.lines` loaded, so this needs no query.
 */
function unfulfilledLines(order: Order): OrderLineInput[] {
    const fulfilled = new Map<string, number>();
    for (const fulfillment of order.fulfillments ?? []) {
        if (fulfillment.state === 'Cancelled') {
            continue;
        }
        for (const line of fulfillment.lines ?? []) {
            const key = String(line.orderLineId);
            fulfilled.set(key, (fulfilled.get(key) ?? 0) + line.quantity);
        }
    }
    const lines: OrderLineInput[] = [];
    for (const line of order.lines) {
        const quantity = line.quantity - (fulfilled.get(String(line.id)) ?? 0);
        if (0 < quantity) {
            lines.push({ orderLineId: line.id, quantity });
        }
    }
    return lines;
}
