import { IllegalOperationError, OrderModificationError, UserInputError } from '@vendure/core';
import { LockNotSupportedOnGivenDriverError } from 'typeorm';
import { describe, expect, it, vi } from 'vitest';

import { McpActiveOrderService } from './active-order.service';

/** A ctx of a test's own, for the tests that read the session back after the call. */
function cartCtx(activeOrderId?: string) {
    return { session: { id: 's1', token: 't1', activeOrderId } };
}

/** A ctx carrying a session, which find/findOrderWithLines require before touching core. */
const ctxWithSession = cartCtx() as never;

/**
 * Stands in for TransactionalConnection. `withTransaction` hands the same ctx through. The query
 * builder chain returns `row` from the locking select, or rejects with `lockError`.
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
        withTransaction: (ctx: unknown, work: (ctx: unknown) => Promise<unknown>) => work(ctx),
        getRepository: () => ({ createQueryBuilder: () => queryBuilder }),
        queryBuilder,
    };
}

describe('McpActiveOrderService', () => {
    describe('find', () => {
        it('returns the active order without loading its lines', async () => {
            const activeOrder = { id: '1', code: 'T_1', currencyCode: 'USD' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub() as never,
            );

            const result = await service.find(ctxWithSession);

            expect(result).toMatchObject({ id: activeOrder.id, currencyCode: activeOrder.currencyCode });
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctxWithSession, undefined);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });
    });

    it.each(['find', 'findOrderWithLines'] as const)(
        '%s returns undefined without touching core when the ctx has no session',
        async method => {
            const activeOrderService = { getActiveOrder: vi.fn() };
            const orderService = { findOne: vi.fn() };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub() as never,
            );

            const result = await service[method]({} as never);

            expect(result).toBeUndefined();
            expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
            expect(orderService.findOne).not.toHaveBeenCalled();
        },
    );

    describe('findOrCreate', () => {
        it('asks Vendure to create a cart when there is none, and loads no lines', async () => {
            const activeOrder = { id: '1', code: 'T_1', currencyCode: 'USD' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub() as never,
            );

            const result = await service.findOrCreate(ctxWithSession);

            expect(result).toMatchObject({ id: activeOrder.id, currencyCode: activeOrder.currencyCode });
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctxWithSession, undefined, true);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });

        it('throws an IllegalOperationError naming the Owner permission when the ctx has no session', async () => {
            const activeOrderService = { getActiveOrder: vi.fn() };
            const orderService = { findOne: vi.fn() };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub() as never,
            );

            await expect(service.findOrCreate({} as never)).rejects.toBeInstanceOf(IllegalOperationError);
            await expect(service.findOrCreate({} as never)).rejects.toThrow(/Owner permission/);
            expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
        });

        it('locks the session row and copies its active order id onto the session before asking core', async () => {
            const activeOrder = { id: '1', code: 'T_1', currencyCode: 'USD' };
            const activeOrderService = { getActiveOrder: vi.fn().mockResolvedValue(activeOrder) };
            const orderService = { findOne: vi.fn() };
            const connection = connectionStub({ row: { activeOrderId: '9' } });
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connection as never,
            );
            const ctx = cartCtx();

            const result = await service.findOrCreate(ctx as never);

            expect(result).toMatchObject({ id: activeOrder.id, currencyCode: activeOrder.currencyCode });
            expect(ctx.session.activeOrderId).toBe('9');
            expect(connection.queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
            expect(connection.queryBuilder.where).toHaveBeenCalledWith('session.id = :id', { id: 's1' });
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctx, undefined, true);
        });

        it('clears a stale cached active order id when the row has none', async () => {
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue({ id: '1', currencyCode: 'USD' }),
            };
            const orderService = { findOne: vi.fn() };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub({ row: {} }) as never,
            );
            const ctx = cartCtx('4');

            await service.findOrCreate(ctx as never);

            expect(ctx.session.activeOrderId).toBeUndefined();
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctx, undefined, true);
        });

        it('goes on without the lock when the database driver does not support it', async () => {
            const activeOrder = { id: '1', code: 'T_1', currencyCode: 'USD' };
            const activeOrderService = { getActiveOrder: vi.fn().mockResolvedValue(activeOrder) };
            const orderService = { findOne: vi.fn() };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub({ lockError: new LockNotSupportedOnGivenDriverError() }) as never,
            );
            const ctx = cartCtx('4');

            const result = await service.findOrCreate(ctx as never);

            expect(result).toMatchObject({ id: activeOrder.id, currencyCode: activeOrder.currencyCode });
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctx, undefined, true);
            expect(ctx.session.activeOrderId).toBe('4');
        });

        it('rethrows any other error from the locking select', async () => {
            const activeOrderService = { getActiveOrder: vi.fn() };
            const orderService = { findOne: vi.fn() };
            const lockError = new Error('connection lost');
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub({ lockError }) as never,
            );
            const ctx = cartCtx();

            await expect(service.findOrCreate(ctx as never)).rejects.toBe(lockError);
            expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
        });
    });

    describe('findOrThrow', () => {
        it('throws a UserInputError naming add_to_cart when there is no cart', async () => {
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(undefined),
            };
            const orderService = { findOne: vi.fn() };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub() as never,
            );

            await expect(service.findOrThrow(ctxWithSession)).rejects.toBeInstanceOf(UserInputError);
            await expect(service.findOrThrow(ctxWithSession)).rejects.toThrow(
                'There is no active cart. Add an item with add_to_cart first.',
            );
        });
    });

    describe('findEditable', () => {
        it('returns the cart when it is in AddingItems', async () => {
            const activeOrderService = {
                getActiveOrder: vi
                    .fn()
                    .mockResolvedValue({ id: '1', code: 'T_1', currencyCode: 'USD', state: 'AddingItems' }),
            };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                { findOne: vi.fn() } as never,
                connectionStub() as never,
            );

            const result = await service.findEditable(ctxWithSession);

            expect(result).toMatchObject({ id: '1', state: 'AddingItems' });
            expect(result).not.toBeInstanceOf(OrderModificationError);
        });

        it('returns an OrderModificationError result when the cart is in ArrangingPayment', async () => {
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue({
                    id: '1',
                    code: 'T_1',
                    currencyCode: 'USD',
                    state: 'ArrangingPayment',
                }),
            };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                { findOne: vi.fn() } as never,
                connectionStub() as never,
            );

            const result = await service.findEditable(ctxWithSession);

            expect(result).toBeInstanceOf(OrderModificationError);
        });
    });

    describe('findOrderWithLines', () => {
        it('returns undefined without fetching relations when no active order exists', async () => {
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(undefined),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub() as never,
            );

            const result = await service.findOrderWithLines(ctxWithSession);

            expect(result).toBeUndefined();
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctxWithSession, undefined);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });

        it('returns the active order re-fetched with line and product variant relations', async () => {
            const activeOrder = { id: '1', code: 'T_1', currencyCode: 'USD' };
            const orderWithRelations = { ...activeOrder, lines: [] };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn().mockResolvedValue(orderWithRelations),
            };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub() as never,
            );

            const result = await service.findOrderWithLines(ctxWithSession);

            expect(orderService.findOne).toHaveBeenCalledWith(ctxWithSession, '1', [
                'lines',
                'lines.productVariant',
                'payments',
                'payments.refunds',
                'shippingLines',
                'customer',
            ]);
            expect(result).toBe(orderWithRelations);
        });

        it('falls back to the active order when the relation fetch finds no order', async () => {
            const activeOrder = { id: '1', code: 'T_1', currencyCode: 'USD' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn().mockResolvedValue(undefined),
            };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                connectionStub() as never,
            );

            const result = await service.findOrderWithLines(ctxWithSession);

            expect(result).toBe(activeOrder);
        });
    });
});
