import {
    IllegalOperationError,
    OrderModificationError,
    TransactionalConnection,
    UserInputError,
} from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { McpActiveOrderService } from './active-order.service';

/** A ctx carrying a session, which find/findOrderWithLines require before touching core. */
const ctxWithSession = { session: { id: 's1', token: 't1' } } as never;

/**
 * Stands in for TransactionalConnection. `withTransaction` hands the same ctx through, and the
 * locking select finds no session row.
 */
function connectionStub() {
    const queryBuilder = {
        setLock: vi.fn(() => queryBuilder),
        where: vi.fn(() => queryBuilder),
        getOne: vi.fn(() => Promise.resolve(null)),
    };
    return {
        withTransaction: (ctx: unknown, work: (ctx: unknown) => Promise<unknown>) => work(ctx),
        getRepository: () => ({ createQueryBuilder: () => queryBuilder }),
        queryBuilder,
    };
}

/** Stands in for ModuleRef, which findOrCreate resolves core services from. */
function moduleRefStub(activeOrderService: unknown, connection = connectionStub()) {
    return {
        get: (token: unknown) => (token === TransactionalConnection ? connection : activeOrderService),
    };
}

/** For the methods that never resolve anything through the ModuleRef. */
const unusedModuleRef = {} as never;

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
                unusedModuleRef,
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
                unusedModuleRef,
            );

            const result = await service[method]({} as never);

            expect(result).toBeUndefined();
            expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
            expect(orderService.findOne).not.toHaveBeenCalled();
        },
    );

    // The lock and the currency binding are tested with findOrCreateActiveOrder in @vendure/mcp-sdk.
    describe('findOrCreate', () => {
        it('asks Vendure to create a cart under the session lock, and loads no lines', async () => {
            const activeOrder = { id: '1', code: 'T_1', currencyCode: 'USD' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const connection = connectionStub();
            const service = new McpActiveOrderService(
                activeOrderService as never,
                orderService as never,
                moduleRefStub(activeOrderService, connection) as never,
            );

            // Already in the cart's currency, so the context comes back as it is.
            const ctx = { session: { id: 's1', token: 't1' }, currencyCode: 'USD' };

            const result = await service.findOrCreate(ctx as never);

            expect(result.order).toMatchObject({
                id: activeOrder.id,
                currencyCode: activeOrder.currencyCode,
            });
            expect(result.ctx).toBe(ctx);
            expect(connection.queryBuilder.setLock).toHaveBeenCalledWith('pessimistic_write');
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctx, undefined, true);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });

        it('throws an IllegalOperationError naming the Owner permission when the ctx has no session', async () => {
            const activeOrderService = { getActiveOrder: vi.fn() };
            const service = new McpActiveOrderService(
                activeOrderService as never,
                { findOne: vi.fn() } as never,
                moduleRefStub(activeOrderService) as never,
            );

            await expect(service.findOrCreate({} as never)).rejects.toBeInstanceOf(IllegalOperationError);
            await expect(service.findOrCreate({} as never)).rejects.toThrow(/Owner permission/);
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
                unusedModuleRef,
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
                unusedModuleRef,
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
                unusedModuleRef,
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
                unusedModuleRef,
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
                unusedModuleRef,
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
                unusedModuleRef,
            );

            const result = await service.findOrderWithLines(ctxWithSession);

            expect(result).toBe(activeOrder);
        });
    });
});
