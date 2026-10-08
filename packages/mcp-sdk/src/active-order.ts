import type { CurrencyCode } from '@vendure/common/lib/generated-types';
import type {
    CachedSession,
    DeserializedCachedSession,
    Injector,
    Order,
    RequestContext,
} from '@vendure/core';
import { ActiveOrderService, IllegalOperationError, Session, TransactionalConnection } from '@vendure/core';

/**
 * @description
 * The result of {@link findOrCreateActiveOrder}.
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export interface McpActiveOrder {
    /**
     * @description
     * The active order of the session. Its lines are not loaded.
     */
    order: Order;
    /**
     * @description
     * The request context in the currency of `order`. Pass it to every core call that changes the
     * order. Core prices the whole order again in the currency of the request context, so a
     * context in another currency moves the order to that currency.
     */
    ctx: RequestContext;
}

/**
 * @description
 * Finds the active order (cart) of the MCP session, or creates one, the same way the built-in
 * `add_to_cart` tool does. Call it in a Shop tool that adds to the cart, instead of
 * `ActiveOrderService.getActiveOrder(ctx, undefined, true)`.
 *
 * - It locks the session row before it looks for the order. Two calls that run at the same time
 *   on one session then use one order. Without the lock, both calls find no order and both
 *   create one. SQLite has no row locks and runs one write at a time, so there it does not lock.
 * - It returns the order and a request context in the order's currency.
 *
 * Set `usesActiveOrder: true` on the tool. The MCP plugin then gives the call a session, and the
 * helper reads the session from `ctx`. Without a session the helper throws an
 * `IllegalOperationError`. You can also call the helper from a service that the tool calls: pass
 * the `ctx` the tool received.
 *
 * Call it after the checks that can refuse the call. Core writes the ID of a new order to the
 * session cache, and a rollback does not undo that.
 *
 * @example
 * ```ts
 * import { Injectable } from '\@nestjs/common';
 * import { ModuleRef } from '\@nestjs/core';
 * import { Injector, OrderService, Permission, RequestContext } from '\@vendure/core';
 * import { findOrCreateActiveOrder, McpTool, McpToolHandler } from '\@vendure/mcp-sdk';
 *
 * \@McpTool({
 *     name: 'add_warranty_to_cart',
 *     toolset: 'shop',
 *     description: 'Add a warranty to the active cart.',
 *     permissions: [Permission.Public],
 *     behavior: 'mutating',
 *     usesActiveOrder: true,
 *     inputSchema: warrantyInput,
 * })
 * \@Injectable()
 * export class AddWarrantyToCartTool implements McpToolHandler<WarrantyInput> {
 *     constructor(
 *         private readonly moduleRef: ModuleRef,
 *         private readonly orderService: OrderService,
 *     ) {}
 *
 *     async execute(ctx: RequestContext, input: WarrantyInput) {
 *         const cart = await findOrCreateActiveOrder(ctx, new Injector(this.moduleRef));
 *         return this.orderService.addItemToOrder(cart.ctx, cart.order.id, input.variantId, 1);
 *     }
 * }
 * ```
 *
 * @docsCategory mcp-sdk
 * @since 3.8.0
 */
export async function findOrCreateActiveOrder(
    ctx: RequestContext,
    injector: Injector,
): Promise<McpActiveOrder> {
    const session = ctx.session;
    if (!session) {
        throw new IllegalOperationError(
            'This tool requires a Vendure session and this call has none. Set usesActiveOrder: true on the tool. ' +
                'In-process callers on the Shop API must give the mutation that calls the tool the Owner ' +
                'permission, so that Vendure creates a session.',
        );
    }
    const connection = injector.get(TransactionalConnection);
    const order = await connection.withTransaction(ctx, async txCtx => {
        await lockSessionRow(connection, txCtx, session);
        // Never undefined: core throws a UserInputError when it can neither find nor create one.
        return injector.get(ActiveOrderService).getActiveOrder(txCtx, undefined, true);
    });
    // Core stores the ID of a new order on the session row and in the cache, but not on this session
    // object. Without it, a later lookup in the same request creates a second order.
    session.activeOrderId = order.id;
    // Bound to the request context, not the transaction context: the transaction's query runner is
    // released when the transaction ends.
    return { order, ctx: inCurrency(ctx, order.currencyCode) };
}

// The lock holds until the transaction ends, so a second call waits here and then reads the order
// ID the first call stored. SQLite skips the lock because it only ever allows one writer at a time.
async function lockSessionRow(
    connection: TransactionalConnection,
    txCtx: RequestContext,
    session: CachedSession | DeserializedCachedSession,
): Promise<void> {
    let row: Session | null;
    try {
        row = await connection
            .getRepository(txCtx, Session)
            .createQueryBuilder('session')
            .setLock('pessimistic_write')
            .where('session.id = :id', { id: session.id })
            .getOne();
    } catch (e) {
        // Matched by name, not instanceof, so the SDK does not load its own copy of typeorm, which
        // can differ from the one core uses.
        if (e instanceof Error && e.name === 'LockNotSupportedOnGivenDriverError') {
            return;
        }
        throw e;
    }
    // The session in the cache can hold an order ID that is older than the row.
    if (row) {
        session.activeOrderId = row.activeOrderId ?? undefined;
    }
}

// Sets the same private field core sets when it changes a cart's currency. The MCP plugin's
// McpToolRegistryService.inCartCurrency does the same for tools with `usesActiveOrder: true`, so
// this changes the context only when the order's currency differs from that of the given context.
// Keep the two in step.
function inCurrency(ctx: RequestContext, currencyCode: CurrencyCode): RequestContext {
    if (ctx.currencyCode === currencyCode) {
        return ctx;
    }
    const copy = ctx.copy();
    (copy as any)._currencyCode = currencyCode;
    return copy;
}
