import { Injectable } from '@nestjs/common';
import {
    ActiveOrderService,
    CachedSession,
    DeserializedCachedSession,
    IllegalOperationError,
    Order,
    OrderModificationError,
    OrderService,
    RequestContext,
    Session,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';

export const NO_CART_MESSAGE =
    'There is no cart for this session. Call add_to_cart first; it returns the sessionToken to ' +
    'use on later calls.';

const EDITABLE_ORDER_STATES: ReadonlySet<Order['state']> = new Set(['AddingItems', 'Draft']);

@Injectable()
export class McpActiveOrderService {
    constructor(
        private readonly activeOrderService: ActiveOrderService,
        private readonly orderService: OrderService,
        private readonly connection: TransactionalConnection,
    ) {}

    /** The shopper's current cart, or undefined when they have none. Order lines are not loaded. */
    async find(ctx: RequestContext): Promise<Order | undefined> {
        // Checked here because core's active-order strategy throws on a missing session instead of
        // just reporting no cart.
        if (!ctx.session) return undefined;

        return this.activeOrderService.getActiveOrder(ctx, undefined);
    }

    // Only add_to_cart may start a cart; every other mutation uses findOrThrow instead.
    async findOrCreate(ctx: RequestContext): Promise<Order> {
        const session = ctx.session;
        if (!session) {
            throw new IllegalOperationError(
                'add_to_cart requires a Vendure session and this call has none. In-process callers on the Shop API ' +
                    'must give the mutation that calls the tool the Owner permission, so that Vendure creates a session.',
            );
        }
        return this.connection.withTransaction(ctx, async txCtx => {
            await this.lockSessionRow(txCtx, session);
            // Never undefined: core throws a UserInputError when it can neither find nor create one.
            return this.activeOrderService.getActiveOrder(txCtx, undefined, true);
        });
    }

    // SQLite skips the lock because it only ever allows one writer at a time anyway.
    private async lockSessionRow(
        txCtx: RequestContext,
        session: CachedSession | DeserializedCachedSession,
    ): Promise<void> {
        let row: Session | null;
        try {
            row = await this.connection
                .getRepository(txCtx, Session)
                .createQueryBuilder('session')
                .setLock('pessimistic_write')
                .where('session.id = :id', { id: session.id })
                .getOne();
        } catch (e) {
            if (e instanceof LockNotSupportedOnGivenDriverError) {
                return;
            }
            throw e;
        }
        if (row) {
            session.activeOrderId = row.activeOrderId ?? undefined;
        }
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
