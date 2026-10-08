import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import {
    ActiveOrderService,
    IllegalOperationError,
    Injector,
    Order,
    OrderModificationError,
    OrderService,
    RequestContext,
    UserInputError,
} from '@vendure/core';
import { findOrCreateActiveOrder, McpActiveOrder } from '@vendure/mcp-sdk';

export const NO_CART_MESSAGE =
    'There is no cart for this session. Call add_to_cart first; it returns the sessionToken to ' +
    'use on later calls.';

const EDITABLE_ORDER_STATES: ReadonlySet<Order['state']> = new Set(['AddingItems', 'Draft']);

@Injectable()
export class McpActiveOrderService {
    constructor(
        private readonly activeOrderService: ActiveOrderService,
        private readonly orderService: OrderService,
        private readonly moduleRef: ModuleRef,
    ) {}

    /** The shopper's current cart, or undefined when they have none. Order lines are not loaded. */
    async find(ctx: RequestContext): Promise<Order | undefined> {
        // Checked here because core's active-order strategy throws on a missing session instead of
        // just reporting no cart.
        if (!ctx.session) return undefined;

        return this.activeOrderService.getActiveOrder(ctx, undefined);
    }

    // Only add_to_cart may start a cart; every other mutation uses findOrThrow instead.
    async findOrCreate(ctx: RequestContext): Promise<McpActiveOrder> {
        if (!ctx.session) {
            throw new IllegalOperationError(
                'add_to_cart requires a Vendure session and this call has none. In-process callers on the Shop API ' +
                    'must give the mutation that calls the tool the Owner permission, so that Vendure creates a session.',
            );
        }
        return findOrCreateActiveOrder(ctx, new Injector(this.moduleRef));
    }

    // Without this check, acting on a cart that doesn't exist would silently create an empty one.
    async findOrThrow(ctx: RequestContext): Promise<Order> {
        const order = await this.find(ctx);
        if (!order) {
            throw new UserInputError('There is no active cart. Add an item with add_to_cart first.');
        }
        return order;
    }

    // Coupon and address changes don't check the cart's state themselves, unlike line and
    // shipping-method changes, so those tools call this instead of findOrThrow.
    async findEditable(ctx: RequestContext): Promise<Order | OrderModificationError> {
        const cart = await this.findOrThrow(ctx);
        return EDITABLE_ORDER_STATES.has(cart.state) ? cart : new OrderModificationError();
    }

    async findOrderWithLines(ctx: RequestContext): Promise<Order | undefined> {
        const order = await this.find(ctx);
        if (!order) {
            return undefined;
        }
        return (
            (await this.orderService.findOne(ctx, order.id, [
                'lines',
                'lines.productVariant',
                'payments',
                'payments.refunds',
                'shippingLines',
                'customer',
            ])) ?? order
        );
    }
}
