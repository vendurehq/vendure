import { UserInputError } from '@vendure/core';
import { describe, expect, it, vi } from 'vitest';

import { McpActiveOrderService } from './active-order.service';

/** A ctx carrying a session, which find/findWithLines require before touching core. */
const ctxWithSession = { session: { id: 's1', token: 't1' } } as never;

describe('McpActiveOrderService', () => {
    describe('find', () => {
        it('returns the active order without loading its lines', async () => {
            const activeOrder = { id: '1', code: 'T_1' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.find(ctxWithSession);

            expect(result).toBe(activeOrder);
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctxWithSession, undefined);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });
    });

    it.each(['find', 'findWithLines'] as const)(
        '%s returns undefined without touching core when the ctx has no session',
        async method => {
            const activeOrderService = { getActiveOrder: vi.fn() };
            const orderService = { findOne: vi.fn() };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service[method]({} as never);

            expect(result).toBeUndefined();
            expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
            expect(orderService.findOne).not.toHaveBeenCalled();
        },
    );

    describe('findOrCreate', () => {
        it('asks Vendure to create a cart when there is none, and loads no lines', async () => {
            const activeOrder = { id: '1', code: 'T_1' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.findOrCreate(ctxWithSession);

            expect(result).toBe(activeOrder);
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctxWithSession, undefined, true);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });

        it('throws a clear error when the ctx has no session', async () => {
            const activeOrderService = { getActiveOrder: vi.fn() };
            const orderService = { findOne: vi.fn() };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            await expect(service.findOrCreate({} as never)).rejects.toThrow(/without a session/);
            expect(activeOrderService.getActiveOrder).not.toHaveBeenCalled();
        });
    });

    describe('findOrThrow', () => {
        it('returns the cart when there is one', async () => {
            const activeOrder = { id: '1', code: 'T_1' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.findOrThrow(ctxWithSession);

            expect(result).toBe(activeOrder);
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctxWithSession, undefined);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });

        it('throws a UserInputError naming add_to_cart when there is no cart', async () => {
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(undefined),
            };
            const orderService = { findOne: vi.fn() };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            await expect(service.findOrThrow(ctxWithSession)).rejects.toBeInstanceOf(UserInputError);
            await expect(service.findOrThrow(ctxWithSession)).rejects.toThrow(
                'There is no active cart. Add an item with add_to_cart first.',
            );
        });
    });

    describe('findWithLines', () => {
        it('returns undefined without fetching relations when no active order exists', async () => {
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(undefined),
            };
            const orderService = {
                findOne: vi.fn(),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.findWithLines(ctxWithSession);

            expect(result).toBeUndefined();
            expect(activeOrderService.getActiveOrder).toHaveBeenCalledWith(ctxWithSession, undefined);
            expect(orderService.findOne).not.toHaveBeenCalled();
        });

        it('returns the active order re-fetched with line and product variant relations', async () => {
            const activeOrder = { id: '1', code: 'T_1' };
            const orderWithRelations = { ...activeOrder, lines: [] };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn().mockResolvedValue(orderWithRelations),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.findWithLines(ctxWithSession);

            expect(orderService.findOne).toHaveBeenCalledWith(ctxWithSession, '1', [
                'lines',
                'lines.productVariant',
                'payments',
                'shippingLines',
            ]);
            expect(result).toBe(orderWithRelations);
        });

        it('falls back to the active order when the relation fetch finds no order', async () => {
            const activeOrder = { id: '1', code: 'T_1' };
            const activeOrderService = {
                getActiveOrder: vi.fn().mockResolvedValue(activeOrder),
            };
            const orderService = {
                findOne: vi.fn().mockResolvedValue(undefined),
            };
            const service = new McpActiveOrderService(activeOrderService as never, orderService as never);

            const result = await service.findWithLines(ctxWithSession);

            expect(result).toBe(activeOrder);
        });
    });
});
