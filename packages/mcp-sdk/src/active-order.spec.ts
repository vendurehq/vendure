import { ActiveOrderService, IllegalOperationError, Injector, TransactionalConnection } from '@vendure/core';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { findOrCreateActiveOrder } from './active-order';

/**
 * Stands in for RequestContext. The currency has to sit behind a getter over a private field, and
 * `copy()` has to keep that getter, because the helper changes a copy's currency by writing the
 * private field, which is what core itself does.
 */
class FakeCtx {
    /** Set only by the transaction stub, so a test can tell the two contexts apart. */
    inTransaction?: boolean;
    private _currencyCode: string;

    constructor(
        currencyCode: string,
        public session?: { id: string; token: string; activeOrderId?: string },
    ) {
        this._currencyCode = currencyCode;
    }

    get currencyCode(): string {
        return this._currencyCode;
    }

    copy(): FakeCtx {
        return Object.assign(Object.create(Object.getPrototypeOf(this)), this);
    }
}

function cartCtx(currencyCode = 'USD', activeOrderId?: string): FakeCtx {
    return new FakeCtx(currencyCode, { id: 's1', token: 't1', activeOrderId });
}

/**
 * Stands in for TransactionalConnection. `withTransaction` hands over a copy of the ctx the way
 * core does. The query builder chain returns `row` from the locking select, or rejects with
 * `lockError`.
 */
function connectionStub(options: { row?: { activeOrderId?: string } | null; lockError?: Error } = {}) {
    const getOne = vi.fn(() =>
        options.lockError ? Promise.reject(options.lockError) : Promise.resolve(options.row ?? null),
    );
    const queryBuilder = {
        setLock: vi.fn(() => queryBuilder),
        where: vi.fn(() => queryBuilder),
        getOne,
    };
    return {
        withTransaction: (ctx: FakeCtx, work: (ctx: unknown) => Promise<unknown>) =>
            work(Object.assign(ctx.copy(), { inTransaction: true })),
        getRepository: () => ({ createQueryBuilder: () => queryBuilder }),
        queryBuilder,
    };
}

function setup(order: unknown, connectionOptions: Parameters<typeof connectionStub>[0] = {}) {
    const activeOrderService = { getActiveOrder: vi.fn().mockResolvedValue(order) };
    const connection = connectionStub(connectionOptions);
    const injector = {
        get: (token: unknown) => {
            if (token === ActiveOrderService) return activeOrderService;
            if (token === TransactionalConnection) return connection;
            throw new Error(`Unexpected token ${String(token)}`);
        },
    } as unknown as Injector;
    return { activeOrderService, connection, injector };
}

describe('findOrCreateActiveOrder', () => {
    it('throws an IllegalOperationError naming usesActiveOrder when the ctx has no session', async () => {
        const { activeOrderService, injector } = setup(undefined);
        const ctx = new FakeCtx('USD');

        await expect(findOrCreateActiveOrder(ctx as never, injector)).rejects.toBeInstanceOf(
            IllegalOperationError,
        );
        await expect(findOrCreateActiveOrder(ctx as never, injector)).rejects.toThrow(/usesActiveOrder/);
        expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
    });

    it('locks the session row and copies its active order id onto the session before asking core', async () => {
        const { activeOrderService, connection, injector } = setup(
            { id: '1', currencyCode: 'USD' },
            { row: { activeOrderId: '9' } },
        );
        const ctx = cartCtx();

        const result = await findOrCreateActiveOrder(ctx as never, injector);

        expect(result.order).toMatchObject({ id: '1', currencyCode: 'USD' });
        expect(ctx.session?.activeOrderId).toBe('9');
        expect(connection.queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
        expect(connection.queryBuilder.where).toHaveBeenCalledWith('session.id = :id', { id: 's1' });
        expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(
            expect.objectContaining({ inTransaction: true }),
            undefined,
            true,
        );
    });

    it('clears a stale cached active order id when the row has none', async () => {
        const { injector } = setup({ id: '1', currencyCode: 'USD' }, { row: {} });
        const ctx = cartCtx('USD', '4');

        await findOrCreateActiveOrder(ctx as never, injector);

        expect(ctx.session?.activeOrderId).toBeUndefined();
    });

    it('goes on without the lock when the database driver does not support it', async () => {
        const { activeOrderService, injector } = setup(
            { id: '1', currencyCode: 'USD' },
            { lockError: new LockNotSupportedOnGivenDriverError() },
        );
        const ctx = cartCtx('USD', '4');

        const result = await findOrCreateActiveOrder(ctx as never, injector);

        expect(result.order).toMatchObject({ id: '1' });
        expect(activeOrderService.getActiveOrder).toHaveBeenCalledOnce();
        expect(ctx.session?.activeOrderId).toBe('4');
    });

    it('rethrows any other error from the locking select', async () => {
        const lockError = new Error('connection lost');
        const { activeOrderService, injector } = setup(undefined, { lockError });

        await expect(findOrCreateActiveOrder(cartCtx() as never, injector)).rejects.toBe(lockError);
        expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
    });

    it('returns the request context itself when the cart is already in its currency', async () => {
        const { injector } = setup({ id: '1', currencyCode: 'USD' });
        const ctx = cartCtx('USD');

        const result = await findOrCreateActiveOrder(ctx as never, injector);

        expect(result.ctx).toBe(ctx);
    });

    it("returns a copy of the request context in the cart's currency", async () => {
        const { injector } = setup({ id: '1', currencyCode: 'EUR' });
        const ctx = cartCtx('USD');

        const result = await findOrCreateActiveOrder(ctx as never, injector);

        expect(result.ctx.currencyCode).toBe('EUR');
        expect(result.ctx.session).toBe(ctx.session);
        expect(ctx.currencyCode).toBe('USD');
        // The transaction context's query runner is released once the transaction ends, so the
        // returned context must never be a copy of it.
        expect((result.ctx as unknown as FakeCtx).inTransaction).toBeUndefined();
    });
});
