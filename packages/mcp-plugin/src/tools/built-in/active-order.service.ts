import { Injectable } from '@nestjs/common';
import {
    ActiveOrderService,
    IllegalOperationError,
    Order,
    OrderService,
    RequestContext,
    Session,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';

export type ActiveOrderRef = Pick<Order, 'id' | 'currencyCode'>;

@Injectable()
export class McpActiveOrderService {
    constructor(
        private activeOrderService: ActiveOrderService,
        private orderService: OrderService,
        private connection: TransactionalConnection,
    ) {}

    /** The shopper's current cart, or undefined when they have none. Order lines are not loaded. */
    async find(ctx: RequestContext): Promise<ActiveOrderRef | undefined> {
        return this.activeOrder(ctx);
    }

    /**
     * The shopper's current cart, creating an empty one when they have none. Order lines are not
     * loaded. `add_to_cart` is the only caller: a cart begins when the first item is added, both in
     * the browser and here, so every other cart mutation uses `findOrThrow` instead.
     */
    async findOrCreate(ctx: RequestContext): Promise<ActiveOrderRef> {
        if (!ctx.session) {
            throw new IllegalOperationError(
                'add_to_cart requires a Vendure session and this call has none. In-process callers on the Shop API ' +
                    'must give the mutation that calls the tool the Owner permission, so that Vendure creates a session.',
            );
        }
        return this.connection.withTransaction(ctx, async txCtx => {
            await this.lockSessionRow(txCtx);
            // Never undefined: core throws a UserInputError when it can neither find nor create one.
            return this.activeOrderService.getActiveOrder(txCtx, undefined, true);
        });
    }

    /**
     * Prevents concurrent cart calls from creating multiple active orders for the same session.
     * Locks the session row and refreshes its active order before the tool runs.
     * SQLite runs without the lock because it allows only one writer at a time.
     */
    private async lockSessionRow(txCtx: RequestContext): Promise<void> {
        const session = txCtx.session;
        if (!session) return;

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

    /**
     * The shopper's current cart, refusing when they have none. Only `add_to_cart` may start a cart,
     * so every other cart mutation goes through here: acting on a cart that does not exist would
     * otherwise create an empty order and report success against it.
     */
    async findOrThrow(ctx: RequestContext): Promise<ActiveOrderRef> {
        const order = await this.find(ctx);
        if (!order) {
            throw new UserInputError('There is no active cart. Add an item with add_to_cart first.');
        }
        return order;
    }

    async findWithLines(ctx: RequestContext): Promise<Order | undefined> {
        const order = await this.activeOrder(ctx);
        if (!order) {
            return undefined;
        }
        return (
            (await this.orderService.findOne(ctx, order.id, [
                'lines',
                'lines.productVariant',
                'payments',
                'shippingLines',
            ])) ?? order
        );
    }

    /**
     * No session (an anonymous shopper without a sessionToken yet) means no cart; core's
     * active-order strategy throws on a missing session.
     */
    private async activeOrder(ctx: RequestContext): Promise<Order | undefined> {
        if (!ctx.session) return undefined;

        return this.activeOrderService.getActiveOrder(ctx, undefined);
    }
}
